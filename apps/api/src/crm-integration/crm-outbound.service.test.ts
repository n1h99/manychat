import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@omnicus/database';
import { describe, expect, it, vi } from 'vitest';

import { CrmOutboundService } from './crm-outbound.service';
import type { CrmOutboundMessageDto } from './dto';

const dto: CrmOutboundMessageDto = {
  crmProjectId: 'cyber-pulse-staging',
  identity: {
    channel: 'telegram',
    channelIdentityId: 'identity-a',
    connectionId: 'connection-a',
  },
  omnicusContactId: 'contact-a',
  omnicusProjectId: 'project-a',
  text: 'Safe outbound text',
};

function database(options: { existing?: boolean; mediaKind?: string; projectId?: string } = {}) {
  const projectId = options.projectId ?? 'project-a';
  const transaction = {
    auditLog: { create: vi.fn() },
    conversation: { upsert: vi.fn().mockResolvedValue({ id: 'conversation-a' }) },
    idempotencyRecord: { create: vi.fn() },
    mediaAsset: {
      findFirst: vi.fn().mockResolvedValue({ id: 'asset-a', kind: options.mediaKind ?? 'VOICE' }),
    },
    message: {
      create: vi.fn().mockResolvedValue({ id: 'message-a' }),
      findFirst: vi.fn().mockResolvedValue({ externalMessageId: 'telegram-message-42' }),
      updateMany: vi.fn(),
    },
    outboxRecord: { create: vi.fn().mockResolvedValue({ id: 'outbox-a' }), updateMany: vi.fn() },
    scheduledMessage: {
      create: vi.fn().mockResolvedValue({ id: 'schedule-a' }),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return {
    client: {
      $transaction: (callback: (input: typeof transaction) => unknown) => callback(transaction),
      channelIdentity: {
        findUnique: vi.fn().mockResolvedValue({
          channel: 'TELEGRAM',
          connection: { status: 'ACTIVE', type: 'TELEGRAM' },
          connectionId: 'connection-a',
          contactId: 'contact-a',
          externalUserId: '123',
          id: 'identity-a',
          status: 'ACTIVE',
        }),
      },
      contact: {
        findUnique: vi.fn().mockResolvedValue({
          crmLeadId: 'crm-lead-a',
          displayName: 'Contact A',
        }),
      },
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      outboxRecord: {
        findUnique: vi.fn().mockResolvedValue(
          options.existing
            ? {
                id: 'outbox-a',
                kind: 'TELEGRAM',
                lastError: null,
                payload: { messageId: 'message-a' },
                status: 'SUCCEEDED',
              }
            : null,
        ),
      },
      message: {
        findUnique: vi.fn().mockResolvedValue({ status: 'SENT' }),
      },
      project: {
        findUnique: vi.fn().mockResolvedValue({
          crmConfig: { crmProjectId: 'cyber-pulse-staging', enabled: true },
          id: projectId,
          name: 'Project A',
          slug: 'project-a',
          status: 'ACTIVE',
        }),
      },
      scheduledMessage: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    },
    transaction,
  };
}

describe('CrmOutboundService', () => {
  it('durably queues a project-scoped Telegram message', async () => {
    const db = database();
    const queue = { enqueue: vi.fn() };
    const service = new CrmOutboundService(db as never, queue as never);

    await expect(service.queue(dto, 'crm-request-a', 'correlation-a')).resolves.toEqual({
      messageId: 'message-a',
      operationId: 'outbox-a',
      replayed: false,
      status: 'QUEUED',
    });

    expect(queue.enqueue).toHaveBeenCalledWith('outbox-a');
    expect(db.transaction.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: { text: dto.text },
          projectId: 'project-a',
          status: 'QUEUED',
        }),
      }),
    );
    expect(JSON.stringify(db.transaction.auditLog.create.mock.calls)).not.toContain(dto.text);
  });

  it('replays the durable result for the same idempotency key', async () => {
    const db = database({ existing: true });
    const queue = { enqueue: vi.fn() };
    const service = new CrmOutboundService(db as never, queue as never);

    await expect(service.queue(dto, 'crm-request-a', 'correlation-a')).resolves.toMatchObject({
      operationId: 'outbox-a',
      replayed: true,
    });
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(db.transaction.message.create).not.toHaveBeenCalled();
  });

  it('persists a one-shot schedule without enqueueing it before its due time', async () => {
    const db = database();
    const queue = { enqueue: vi.fn() };
    const service = new CrmOutboundService(db as never, queue as never);
    const scheduledAt = new Date(Date.now() + 60_000).toISOString();

    await expect(
      service.queue(
        { ...dto, scheduledAt, timezone: 'Asia/Baku' },
        'crm-schedule-a',
        'correlation-a',
      ),
    ).resolves.toEqual({
      channelIdentityId: 'identity-a',
      connectionId: 'connection-a',
      crmLeadId: 'crm-lead-a',
      messageId: 'message-a',
      omnicusContactId: 'contact-a',
      operationId: 'outbox-a',
      replayed: false,
      scheduleId: 'schedule-a',
      status: 'QUEUED',
    });

    expect(db.transaction.outboxRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: 'crm-scheduled-crm-schedule-a',
          nextAttemptAt: new Date(scheduledAt),
        }),
      }),
    );
    expect(db.transaction.scheduledMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scheduledAt: new Date(scheduledAt),
          timezone: 'Asia/Baku',
        }),
      }),
    );
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('persists a bounded recurring schedule and its first occurrence', async () => {
    const db = database();
    const service = new CrmOutboundService(db as never, { enqueue: vi.fn() } as never);
    const scheduledAt = new Date(Date.now() + 60_000).toISOString();

    await service.queue(
      {
        ...dto,
        recurrence: { count: 4, frequency: 'WEEKLY', interval: 2 },
        scheduledAt,
        timezone: 'Asia/Baku',
      },
      'crm-recurring-a',
      'correlation-a',
    );

    expect(db.transaction.scheduledMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          occurrence: 1,
          recurrence: { count: 4, frequency: 'WEEKLY', interval: 2 },
          seriesId: 'outbox-a',
        }),
      }),
    );
  });

  it('rejects a recurrence that ends before its first scheduled occurrence', async () => {
    const db = database();
    const service = new CrmOutboundService(db as never, { enqueue: vi.fn() } as never);
    const scheduledAt = new Date(Date.now() + 120_000);

    await expect(
      service.queue(
        {
          ...dto,
          recurrence: {
            frequency: 'DAILY',
            interval: 1,
            until: new Date(Date.now() + 60_000).toISOString(),
          },
          scheduledAt: scheduledAt.toISOString(),
          timezone: 'UTC',
        },
        'crm-invalid-recurrence-a',
        'correlation-a',
      ),
    ).rejects.toMatchObject({ response: { code: 'CRM_RECURRENCE_END_INVALID' } });
    expect(db.transaction.message.create).not.toHaveBeenCalled();
  });

  it('updates a queued schedule once and replays the safe idempotent result', async () => {
    const db = database();
    const scheduledAt = new Date(Date.now() + 120_000).toISOString();
    const schedule = {
      cancelledAt: null,
      channelIdentityId: 'identity-a',
      completedAt: null,
      connectionId: 'connection-a',
      contact: { crmLeadId: 'crm-lead-a' },
      contactId: 'contact-a',
      id: 'schedule-a',
      messageId: 'message-a',
      occurrence: 1,
      outboxRecordId: 'outbox-a',
      projectId: 'project-a',
      recurrence: null,
      revision: 1,
      scheduledAt: new Date(Date.now() + 60_000),
      seriesId: 'outbox-a',
      status: 'QUEUED',
      timezone: 'Asia/Baku',
    };
    db.transaction.scheduledMessage.findFirst.mockResolvedValue(schedule);
    db.transaction.scheduledMessage.findUniqueOrThrow.mockResolvedValue({
      ...schedule,
      recurrence: { count: 3, frequency: 'DAILY', interval: 1 },
      revision: 2,
      scheduledAt: new Date(scheduledAt),
    });
    const service = new CrmOutboundService(db as never, { enqueue: vi.fn() } as never);
    const query = {
      connectionId: 'connection-a',
      crmLeadId: 'crm-lead-a',
      crmProjectId: 'cyber-pulse-staging',
      omnicusContactId: 'contact-a',
      omnicusProjectId: 'project-a',
    };
    const update = {
      expectedRevision: 1,
      recurrence: { count: 3, frequency: 'DAILY' as const, interval: 1 },
      scheduledAt,
    };

    const first = await service.updateScheduled(
      'schedule-a',
      update,
      query,
      'schedule-update-a',
      'correlation-a',
    );
    expect(first).toMatchObject({ id: 'schedule-a', replayed: false, revision: 2 });
    expect(db.transaction.idempotencyRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          key: 'schedule-update-a',
          scope: 'crm-scheduled-update',
        }),
      }),
    );

    const resultSafe = db.transaction.idempotencyRecord.create.mock.calls[0]?.[0].data.resultSafe;
    db.client.idempotencyRecord.findUnique.mockResolvedValue({ resultSafe });
    const replay = await service.updateScheduled(
      'schedule-a',
      update,
      query,
      'schedule-update-a',
      'another-correlation',
    );
    expect(replay).toMatchObject({ id: 'schedule-a', replayed: true, revision: 2 });
    expect(db.transaction.scheduledMessage.updateMany).toHaveBeenCalledTimes(1);
  });

  it('distinguishes preserving recurrence from explicitly clearing it', async () => {
    const db = database();
    const schedule = {
      cancelledAt: null,
      channelIdentityId: 'identity-a',
      completedAt: null,
      connectionId: 'connection-a',
      contact: { crmLeadId: 'crm-lead-a' },
      contactId: 'contact-a',
      id: 'schedule-a',
      messageId: 'message-a',
      occurrence: 1,
      outboxRecordId: 'outbox-a',
      projectId: 'project-a',
      recurrence: { count: 3, frequency: 'DAILY', interval: 1 },
      revision: 1,
      scheduledAt: new Date(Date.now() + 60_000),
      seriesId: 'outbox-a',
      status: 'QUEUED',
      timezone: 'UTC',
    };
    db.transaction.scheduledMessage.findFirst.mockResolvedValue(schedule);
    db.transaction.scheduledMessage.findUniqueOrThrow.mockResolvedValue({
      ...schedule,
      recurrence: null,
      revision: 2,
    });
    const service = new CrmOutboundService(db as never, { enqueue: vi.fn() } as never);

    await service.updateScheduled(
      'schedule-a',
      { expectedRevision: 1, recurrence: null },
      {
        connectionId: 'connection-a',
        crmLeadId: 'crm-lead-a',
        crmProjectId: 'cyber-pulse-staging',
        omnicusContactId: 'contact-a',
        omnicusProjectId: 'project-a',
      },
      'clear-recurrence-a',
      'correlation-a',
    );

    expect(db.transaction.scheduledMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ recurrence: Prisma.DbNull }),
      }),
    );
    expect(db.transaction.idempotencyRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resultSafe: expect.objectContaining({
            request: expect.objectContaining({ recurrenceMode: 'CLEAR' }),
          }),
        }),
      }),
    );
  });

  it('lists only schedules inside the required lead and connection scope', async () => {
    const db = database();
    db.client.scheduledMessage.findMany.mockResolvedValue([
      {
        cancelledAt: null,
        channelIdentityId: 'identity-a',
        completedAt: null,
        connectionId: 'connection-a',
        contact: { crmLeadId: 'crm-lead-a' },
        contactId: 'contact-a',
        id: 'schedule-a',
        messageId: 'message-a',
        occurrence: 1,
        outboxRecordId: 'outbox-a',
        scheduledAt: new Date('2026-08-03T10:00:00.000Z'),
        seriesId: 'outbox-a',
        status: 'QUEUED',
        timezone: 'Asia/Baku',
      },
    ]);
    const service = new CrmOutboundService(db as never, { enqueue: vi.fn() } as never);

    await expect(
      service.scheduledList({
        channelIdentityId: 'identity-a',
        connectionId: 'connection-a',
        crmLeadId: 'crm-lead-a',
        crmProjectId: 'cyber-pulse-staging',
        omnicusContactId: 'contact-a',
        omnicusProjectId: 'project-a',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        channelIdentityId: 'identity-a',
        connectionId: 'connection-a',
        crmLeadId: 'crm-lead-a',
        id: 'schedule-a',
        omnicusContactId: 'contact-a',
      }),
    ]);
    expect(db.client.scheduledMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          channelIdentityId: 'identity-a',
          connectionId: 'connection-a',
          contact: { crmLeadId: 'crm-lead-a' },
          contactId: 'contact-a',
          projectId: 'project-a',
        },
      }),
    );
  });

  it('hides a schedule when its lead scope does not match', async () => {
    const db = database();
    const service = new CrmOutboundService(db as never, { enqueue: vi.fn() } as never);

    await expect(
      service.scheduled('schedule-a', {
        connectionId: 'connection-a',
        crmLeadId: 'another-lead',
        crmProjectId: 'cyber-pulse-staging',
        omnicusContactId: 'contact-a',
        omnicusProjectId: 'project-a',
      }),
    ).rejects.toMatchObject({ response: { code: 'CRM_SCHEDULE_NOT_FOUND' } });
    expect(db.client.scheduledMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contact: { crmLeadId: 'another-lead' } }),
      }),
    );
  });

  it('cancels a queued schedule only after the full lead scope resolves', async () => {
    const db = database();
    db.transaction.scheduledMessage.findFirst.mockResolvedValue({
      channelIdentityId: 'identity-a',
      connectionId: 'connection-a',
      contact: { crmLeadId: 'crm-lead-a' },
      contactId: 'contact-a',
      id: 'schedule-a',
      messageId: 'message-a',
      outboxRecordId: 'outbox-a',
      status: 'QUEUED',
    });
    const service = new CrmOutboundService(db as never, { enqueue: vi.fn() } as never);

    await expect(
      service.cancelScheduled('schedule-a', {
        channelIdentityId: 'identity-a',
        connectionId: 'connection-a',
        crmLeadId: 'crm-lead-a',
        crmProjectId: 'cyber-pulse-staging',
        omnicusContactId: 'contact-a',
        omnicusProjectId: 'project-a',
      }),
    ).resolves.toEqual({
      channelIdentityId: 'identity-a',
      connectionId: 'connection-a',
      crmLeadId: 'crm-lead-a',
      id: 'schedule-a',
      omnicusContactId: 'contact-a',
      replayed: false,
      status: 'CANCELLED',
    });
    expect(db.transaction.scheduledMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          channelIdentityId: 'identity-a',
          connectionId: 'connection-a',
          contactId: 'contact-a',
          projectId: 'project-a',
        }),
      }),
    );
  });

  it('rejects cross-project routing before creating side effects', async () => {
    const db = database({ projectId: 'different-project' });
    db.client.project.findUnique.mockResolvedValue(null);
    const service = new CrmOutboundService(db as never, { enqueue: vi.fn() } as never);

    await expect(service.queue(dto, 'crm-request-a', 'correlation-a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(db.transaction.message.create).not.toHaveBeenCalled();
  });

  it('keeps the PostgreSQL record when Redis enqueue fails', async () => {
    const db = database();
    const service = new CrmOutboundService(
      db as never,
      { enqueue: vi.fn().mockRejectedValue(new Error('redis unavailable')) } as never,
    );

    await expect(service.queue(dto, 'crm-request-a', 'correlation-a')).resolves.toMatchObject({
      operationId: 'outbox-a',
      status: 'QUEUED',
    });
    expect(db.transaction.outboxRecord.create).toHaveBeenCalled();
  });

  it('queues media, reply and inline keyboard without exposing provider credentials', async () => {
    const db = database();
    const service = new CrmOutboundService(db as never, { enqueue: vi.fn() } as never);
    await service.queue(
      {
        crmProjectId: dto.crmProjectId,
        identity: dto.identity,
        inlineKeyboard: [[{ callbackData: 'budget:1000', text: 'До 1000' }]],
        media: { kind: 'VOICE', mediaAssetId: 'asset-a' },
        omnicusContactId: dto.omnicusContactId,
        omnicusProjectId: dto.omnicusProjectId,
        replyToMessageId: '11111111-1111-4111-8111-111111111111',
      },
      'crm-media-request-a',
      'correlation-a',
    );

    expect(db.transaction.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          connectionId: 'connection-a',
          projectId: 'project-a',
        }),
      }),
    );
    expect(db.transaction.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mediaAssetId: 'asset-a',
          metadata: expect.objectContaining({
            replyToMessageId: 'telegram-message-42',
          }),
          type: 'VOICE',
        }),
      }),
    );
  });

  it('queues a native rich message with a validated reply keyboard', async () => {
    const db = database();
    const service = new CrmOutboundService(db as never, { enqueue: vi.fn() } as never);

    await service.queue(
      {
        crmProjectId: dto.crmProjectId,
        identity: dto.identity,
        omnicusContactId: dto.omnicusContactId,
        omnicusProjectId: dto.omnicusProjectId,
        replyMarkup: {
          inputFieldPlaceholder: 'Choose an action',
          keyboard: [[{ text: 'Share location', requestLocation: true }]],
          type: 'reply_keyboard',
        },
        richMessage: { markdown: '**Safe rich text**' },
      },
      'crm-rich-request-a',
      'correlation-a',
    );

    expect(db.transaction.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: { richMessage: { markdown: '**Safe rich text**' } },
          metadata: expect.objectContaining({
            replyMarkup: expect.objectContaining({ type: 'reply_keyboard' }),
          }),
          type: 'RICH',
        }),
      }),
    );
  });

  it('queues a captionless sticker and persists supported media spoiler metadata', async () => {
    const stickerDatabase = database({ mediaKind: 'STICKER' });
    const stickerService = new CrmOutboundService(
      stickerDatabase as never,
      { enqueue: vi.fn() } as never,
    );
    await stickerService.queue(
      {
        crmProjectId: dto.crmProjectId,
        identity: dto.identity,
        media: { kind: 'STICKER', mediaAssetId: 'asset-a' },
        omnicusContactId: dto.omnicusContactId,
        omnicusProjectId: dto.omnicusProjectId,
      },
      'crm-sticker-request-a',
      'correlation-a',
    );
    expect(stickerDatabase.transaction.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: { caption: '' }, type: 'STICKER' }),
      }),
    );

    const photoDatabase = database({ mediaKind: 'PHOTO' });
    await new CrmOutboundService(photoDatabase as never, { enqueue: vi.fn() } as never).queue(
      {
        crmProjectId: dto.crmProjectId,
        hasSpoiler: true,
        identity: dto.identity,
        media: { kind: 'PHOTO', mediaAssetId: 'asset-a' },
        omnicusContactId: dto.omnicusContactId,
        omnicusProjectId: dto.omnicusProjectId,
      },
      'crm-spoiler-request-a',
      'correlation-a',
    );
    expect(photoDatabase.transaction.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metadata: expect.objectContaining({ hasSpoiler: true }) }),
      }),
    );
  });

  it('rejects sticker captions and unsupported spoiler kinds before database writes', async () => {
    const db = database({ mediaKind: 'STICKER' });
    const service = new CrmOutboundService(db as never, { enqueue: vi.fn() } as never);

    await expect(
      service.queue(
        {
          crmProjectId: dto.crmProjectId,
          identity: dto.identity,
          media: { kind: 'STICKER', mediaAssetId: 'asset-a' },
          omnicusContactId: dto.omnicusContactId,
          omnicusProjectId: dto.omnicusProjectId,
          text: 'unsupported caption',
        },
        'crm-invalid-sticker',
        'correlation-a',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.queue(
        {
          crmProjectId: dto.crmProjectId,
          hasSpoiler: true,
          identity: dto.identity,
          media: { kind: 'STICKER', mediaAssetId: 'asset-a' },
          omnicusContactId: dto.omnicusContactId,
          omnicusProjectId: dto.omnicusProjectId,
        },
        'crm-invalid-spoiler',
        'correlation-a',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.transaction.message.create).not.toHaveBeenCalled();
  });

  it('reconciles a confirmed sent message without exposing outbox payload', async () => {
    const db = database({ existing: true });
    const service = new CrmOutboundService(db as never, { enqueue: vi.fn() } as never);

    await expect(service.status('outbox-a', 'cyber-pulse-staging', 'project-a')).resolves.toEqual({
      messageId: 'message-a',
      operationId: 'outbox-a',
      status: 'SENT',
    });
  });
});
