import { NotFoundException } from '@nestjs/common';
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

function database(options: { existing?: boolean; projectId?: string } = {}) {
  const projectId = options.projectId ?? 'project-a';
  const transaction = {
    auditLog: { create: vi.fn() },
    conversation: { upsert: vi.fn().mockResolvedValue({ id: 'conversation-a' }) },
    idempotencyRecord: { create: vi.fn() },
    message: { create: vi.fn().mockResolvedValue({ id: 'message-a' }) },
    outboxRecord: { create: vi.fn().mockResolvedValue({ id: 'outbox-a' }) },
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
