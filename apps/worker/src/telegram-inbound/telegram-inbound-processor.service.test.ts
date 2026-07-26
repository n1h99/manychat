import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { telegramInboundFixtures } from '@omnicus/test-fixtures';
import { describe, expect, it, vi } from 'vitest';

import { TelegramInboundProcessorService } from './telegram-inbound-processor.service';

const TEST_CHANNEL_SECRETS_KEY = Buffer.alloc(32, 1).toString('base64');
const receivedAt = new Date('2026-07-26T10:00:00.000Z');

interface HarnessOptions {
  connectionId?: string;
  existingContactId?: string;
  lockedAt?: Date | null;
  payload?: unknown;
  projectId?: string;
  status?: 'COMPLETED' | 'DEAD_LETTER' | 'FAILED' | 'PENDING' | 'PROCESSING' | 'RETRY';
}

function createHarness(options: HarnessOptions = {}) {
  const record = {
    attempts: 0,
    connectionId: options.connectionId ?? 'connection-a',
    id: 'inbox-a',
    lockedAt: options.lockedAt ?? null,
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
  const inboxUpdate = vi
    .fn()
    .mockImplementation(async ({ data }: { data: { status: typeof record.status } }) => {
      record.status = data.status;
    });
  const transaction = {
    channelIdentity: {
      create: identityCreate,
      findUnique: identityFindUnique,
      update: identityUpdate,
    },
    contact: { create: contactCreate, update: contactUpdate, updateMany: contactUpdateMany },
    conversation: { upsert: conversationUpsert },
    inboxRecord: { update: inboxUpdate },
    message: { upsert: messageUpsert },
    normalizedEvent: { upsert: normalizedUpsert },
  };
  const inboxUpdateMany = vi
    .fn()
    .mockImplementation(async (input: { data: Record<string, unknown> }) => {
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
          return { count: 1 };
        }
        return { count: 0 };
      }
      if (input.data.status === 'RETRY') record.status = 'RETRY';
      return { count: 1 };
    });
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
    normalizedUpsert,
    record,
    service,
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
    const { contactCreate, contactUpdateMany, service } = createHarness({
      existingContactId: 'contact-existing',
    });

    await service.process({ inboxRecordId: 'inbox-a' });

    expect(contactCreate).not.toHaveBeenCalled();
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
    const { messageUpsert, service } = createHarness({ payload });

    await service.process({ inboxRecordId: 'inbox-a' });

    expect(messageUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ type }) }),
    );
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

  it('marks malformed events retryable without logging raw payload', async () => {
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
            status: 'RETRY',
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
});
