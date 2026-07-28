import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { telegramInboundFixtures } from '@omnicus/test-fixtures';
import { describe, expect, it, vi } from 'vitest';

import { TelegramInboundProcessorService } from './telegram-inbound-processor.service';

const TEST_CHANNEL_SECRETS_KEY = Buffer.alloc(32, 1).toString('base64');
const receivedAt = new Date('2026-07-26T10:00:00.000Z');

interface HarnessOptions {
  attempts?: number;
  connectionId?: string;
  existingContactId?: string;
  lockedAt?: Date | null;
  payload?: unknown;
  projectId?: string;
  maxAttempts?: number;
  status?: 'COMPLETED' | 'DEAD_LETTER' | 'FAILED' | 'PENDING' | 'PROCESSING' | 'RETRY';
}

function createHarness(options: HarnessOptions = {}) {
  const record = {
    attempts: options.attempts ?? 0,
    connectionId: options.connectionId ?? 'connection-a',
    id: 'inbox-a',
    lockedAt: options.lockedAt ?? null,
    lockedBy: null as string | null,
    maxAttempts: options.maxAttempts ?? 8,
    projectId: options.projectId ?? 'project-a',
    rawWebhookEvent: {
      payload: options.payload ?? telegramInboundFixtures.text.payload,
      receivedAt,
    },
    status: options.status ?? 'PENDING',
  };
  const normalizedUpsert = vi.fn().mockResolvedValue({ id: 'normalized-a' });
  const contactCreate = vi.fn().mockResolvedValue({ id: 'contact-a' });
  const contactUpdate = vi.fn().mockResolvedValue(undefined);
  const contactUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const identityFindUnique = vi
    .fn()
    .mockResolvedValue(options.existingContactId ? { contactId: options.existingContactId } : null);
  const identityCreate = vi.fn().mockResolvedValue({ id: 'identity-a' });
  const identityUpdate = vi.fn().mockResolvedValue(undefined);
  const conversationUpsert = vi.fn().mockResolvedValue({ id: 'conversation-a' });
  const messageUpsert = vi.fn().mockResolvedValue({ id: 'message-a' });
  const messageUpdate = vi.fn().mockResolvedValue({ id: 'message-a' });
  const mediaAssetUpsert = vi.fn().mockResolvedValue({ id: 'media-a' });
  const inboxUpdate = vi
    .fn()
    .mockImplementation(async ({ data }: { data: { status: typeof record.status } }) => {
      record.status = data.status;
    });
  const transactionInboxUpdateMany = vi
    .fn()
    .mockImplementation(
      async ({
        data,
        where,
      }: {
        data: Record<string, unknown>;
        where: Record<string, unknown>;
      }) => {
        if (where.lockedBy !== record.lockedBy || record.status !== 'PROCESSING')
          return { count: 0 };
        record.status = data.status as typeof record.status;
        record.lockedAt = null;
        return { count: 1 };
      },
    );
  const transaction = {
    channelIdentity: {
      create: identityCreate,
      findUnique: identityFindUnique,
      update: identityUpdate,
    },
    contact: { create: contactCreate, update: contactUpdate, updateMany: contactUpdateMany },
    conversation: { upsert: conversationUpsert },
    inboxRecord: { update: inboxUpdate, updateMany: transactionInboxUpdateMany },
    mediaAsset: { upsert: mediaAssetUpsert },
    message: { update: messageUpdate, upsert: messageUpsert },
    normalizedEvent: { upsert: normalizedUpsert },
    outboxRecord: { upsert: vi.fn().mockResolvedValue({ id: 'callback-outbox-a' }) },
  };
  const inboxUpdateMany = vi
    .fn()
    .mockImplementation(
      async (input: { data: Record<string, unknown>; where: Record<string, unknown> }) => {
        if (input.data.status === 'PROCESSING') {
          if (
            record.status === 'PENDING' ||
            record.status === 'RETRY' ||
            (record.status === 'PROCESSING' &&
              (record.lockedAt === null || record.lockedAt.getTime() < Date.now() - 60_000))
          ) {
            record.status = 'PROCESSING';
            record.attempts += 1;
            record.lockedAt = new Date();
            record.lockedBy = input.data.lockedBy as string;
            return { count: 1 };
          }
          return { count: 0 };
        }
        if (input.data.status === 'RETRY' || input.data.status === 'DEAD_LETTER') {
          if (input.where.lockedBy !== record.lockedBy) return { count: 0 };
          record.status = input.data.status;
          record.lockedAt = null;
          record.lockedBy = null;
        }
        return { count: 1 };
      },
    );
  const database = {
    client: {
      $transaction: vi.fn(async (callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
      inboxRecord: {
        findUnique: vi.fn().mockResolvedValue(record),
        updateMany: inboxUpdateMany,
      },
    },
  };
  const config = new ConfigService({
    APP_ENV: 'test',
    CHANNEL_SECRETS_KEY: TEST_CHANNEL_SECRETS_KEY,
    DATABASE_URL: 'postgresql://omnicus:omnicus@localhost:5432/omnicus',
    DEMO_JOB_ENABLED: false,
    NODE_ENV: 'test',
    REDIS_URL: 'redis://localhost:6379/0',
  });
  const service = new TelegramInboundProcessorService(config as never, database as never);
  return {
    contactCreate,
    contactUpdateMany,
    conversationUpsert,
    database,
    identityCreate,
    identityUpdate,
    inboxUpdateMany,
    messageUpsert,
    messageUpdate,
    mediaAssetUpsert,
    normalizedUpsert,
    record,
    service,
    transactionInboxUpdateMany,
  };
}

describe('TelegramInboundProcessorService', () => {
  it('creates a contact, identity, conversation, normalized event, and message for a first text event', async () => {
    const {
      contactCreate,
      conversationUpsert,
      identityCreate,
      messageUpsert,
      normalizedUpsert,
      service,
    } = createHarness();

    await service.process({ inboxRecordId: 'inbox-a' });
    await service.process({ inboxRecordId: 'inbox-a' });

    expect(contactCreate).toHaveBeenCalledOnce();
    expect(identityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ connectionId: 'connection-a', externalUserId: '1001' }),
      }),
    );
    expect(conversationUpsert).toHaveBeenCalledOnce();
    expect(normalizedUpsert).toHaveBeenCalledOnce();
    expect(contactCreate).toHaveBeenCalledOnce();
    expect(messageUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ direction: 'INBOUND', type: 'TEXT' }),
      }),
    );
  });

  it('uses the existing contact and does not decrease last interaction time on a later retry', async () => {
    const { contactCreate, contactUpdateMany, identityUpdate, service } = createHarness({
      existingContactId: 'contact-existing',
    });

    await service.process({ inboxRecordId: 'inbox-a' });

    expect(contactCreate).not.toHaveBeenCalled();
    expect(identityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    );
    expect(contactUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ lastInteractionAt: null }, { lastInteractionAt: { lt: receivedAt } }],
        }),
      }),
    );
  });

  it('keeps Telegram users isolated by connection scope', async () => {
    const first = createHarness({ connectionId: 'connection-a' });
    const second = createHarness({ connectionId: 'connection-b', projectId: 'project-b' });

    await first.service.process({ inboxRecordId: 'inbox-a' });
    await second.service.process({ inboxRecordId: 'inbox-a' });

    expect(first.identityCreate.mock.calls[0]![0].data.connectionId).toBe('connection-a');
    expect(second.identityCreate.mock.calls[0]![0].data.connectionId).toBe('connection-b');
    expect(second.identityCreate.mock.calls[0]![0].data.projectId).toBe('project-b');
  });

  it('does not repeat persistence when a completed inbox job is redelivered', async () => {
    const { database, service } = createHarness({ status: 'COMPLETED' });

    await service.process({ inboxRecordId: 'inbox-a' });

    expect(database.client.$transaction).not.toHaveBeenCalled();
  });

  it('does not claim a current processing lease but reclaims an expired one', async () => {
    const active = createHarness({ lockedAt: new Date(), status: 'PROCESSING' });
    await active.service.process({ inboxRecordId: 'inbox-a' });
    expect(active.database.client.$transaction).not.toHaveBeenCalled();

    const expired = createHarness({
      lockedAt: new Date(Date.now() - 61_000),
      status: 'PROCESSING',
    });
    await expired.service.process({ inboxRecordId: 'inbox-a' });
    expect(expired.database.client.$transaction).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'command',
      {
        ...telegramInboundFixtures.text.payload,
        message: { ...telegramInboundFixtures.text.payload.message, text: '/start first second' },
      },
      'COMMAND',
    ],
    ['photo', telegramInboundFixtures.photo.payload, 'PHOTO'],
    ['document', telegramInboundFixtures.document.payload, 'DOCUMENT'],
    ['callback', telegramInboundFixtures.callbackQuery.payload, 'CALLBACK_QUERY'],
  ])('persists %s metadata without downloading media', async (_name, payload, type) => {
    const { mediaAssetUpsert, messageUpdate, messageUpsert, service } = createHarness({ payload });

    await service.process({ inboxRecordId: 'inbox-a' });

    expect(messageUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ type }) }),
    );
    if (type === 'PHOTO' || type === 'DOCUMENT') {
      expect(mediaAssetUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            source: 'TELEGRAM',
            status: 'PROVIDER_REFERENCE',
          }),
        }),
      );
      expect(messageUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { mediaAssetId: 'media-a' } }),
      );
    } else {
      expect(mediaAssetUpsert).not.toHaveBeenCalled();
    }
  });

  it('updates existing identities for blocked and unblocked chat member events', async () => {
    const blocked = createHarness({
      existingContactId: 'contact-existing',
      payload: telegramInboundFixtures.blocked.payload,
    });
    await blocked.service.process({ inboxRecordId: 'inbox-a' });
    expect(blocked.identityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'BLOCKED' }) }),
    );

    const unblocked = createHarness({
      existingContactId: 'contact-existing',
      payload: telegramInboundFixtures.unblocked.payload,
    });
    await unblocked.service.process({ inboxRecordId: 'inbox-a' });
    expect(unblocked.identityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }),
    );
  });

  it('stores an unsupported event without creating a contact or message', async () => {
    const { contactCreate, messageUpsert, normalizedUpsert, service } = createHarness({
      payload: telegramInboundFixtures.unsupported.payload,
    });

    await service.process({ inboxRecordId: 'inbox-a' });

    expect(normalizedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ type: 'UNSUPPORTED' }) }),
    );
    expect(contactCreate).not.toHaveBeenCalled();
    expect(messageUpsert).not.toHaveBeenCalled();
  });

  it('dead-letters malformed events without logging raw payload', async () => {
    const { inboxUpdateMany, service } = createHarness({
      payload: telegramInboundFixtures.malformed.payload,
    });
    const warning = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    try {
      await expect(service.process({ inboxRecordId: 'inbox-a' })).rejects.toThrow(
        'Telegram update is malformed',
      );
      expect(inboxUpdateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastError: 'telegram_inbound_malformed_update',
            status: 'DEAD_LETTER',
          }),
        }),
      );
      expect(JSON.stringify(warning.mock.calls)).not.toContain(
        JSON.stringify(telegramInboundFixtures.malformed.payload),
      );
    } finally {
      warning.mockRestore();
    }
  });

  it('schedules retryable failures with a safe code and clears the lease', async () => {
    const { inboxUpdateMany, normalizedUpsert, record, service } = createHarness();
    normalizedUpsert.mockRejectedValueOnce(new Error('sensitive dependency response'));

    await expect(service.process({ inboxRecordId: 'inbox-a' })).rejects.toThrow(
      'sensitive dependency response',
    );

    expect(record.status).toBe('RETRY');
    expect(record.lockedAt).toBeNull();
    expect(inboxUpdateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastError: 'telegram_inbound_processing_failed',
          status: 'RETRY',
        }),
      }),
    );
  });

  it('dead-letters retryable failures after the claimed maximum attempt', async () => {
    const { normalizedUpsert, record, service } = createHarness({ attempts: 7, maxAttempts: 8 });
    normalizedUpsert.mockRejectedValueOnce(new Error('temporary failure'));

    await expect(service.process({ inboxRecordId: 'inbox-a' })).rejects.toThrow(
      'temporary failure',
    );
    expect(record.status).toBe('DEAD_LETTER');
  });

  it('does not let a stale worker complete or release a newer lease', async () => {
    const { record, service, transactionInboxUpdateMany } = createHarness();
    transactionInboxUpdateMany.mockImplementationOnce(async () => {
      record.lockedBy = 'newer-lease';
      return { count: 0 };
    });

    await expect(service.process({ inboxRecordId: 'inbox-a' })).rejects.toThrow(
      'Telegram inbound lease was replaced before completion',
    );
    expect(record.status).toBe('PROCESSING');
    expect(record.lockedBy).toBe('newer-lease');
  });
});
