import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { TelegramOutboundProcessorService } from './telegram-outbound-processor.service';
import { TelegramOutboundRecoveryService } from './telegram-outbound-recovery.service';

const now = new Date('2026-07-28T12:00:00.000Z');

function config() {
  return new ConfigService({
    APP_ENV: 'test',
    CHANNEL_SECRETS_KEY: Buffer.alloc(32, 9).toString('base64'),
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379/0',
    TELEGRAM_OUTBOUND_LEASE_MS: 60_000,
    TELEGRAM_OUTBOUND_RECOVERY_BATCH_SIZE: 10,
    TELEGRAM_OUTBOUND_RECOVERY_INTERVAL_MS: 10_000,
  });
}

describe('Telegram outbound initial scheduling', () => {
  it('recovers legacy pending records whose nextAttemptAt is null', async () => {
    const add = vi.fn().mockResolvedValue({});
    const findMany = vi
      .fn()
      .mockResolvedValue([{ id: 'outbox-a', projectId: 'project-a', status: 'PENDING' }]);
    const service = new TelegramOutboundRecoveryService(
      config() as never,
      {
        client: {
          outboxRecord: {
            findMany,
            updateMany: vi.fn(),
          },
        },
      } as never,
      {
        add,
        close: vi.fn().mockResolvedValue(undefined),
      } as never,
    );

    await service.scanOnce(now);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            {
              status: 'PENDING',
              OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
            },
          ]),
        }),
      }),
    );
    expect(add).toHaveBeenCalledWith(
      'deliver-outbox-record',
      { outboxRecordId: 'outbox-a' },
      expect.objectContaining({ jobId: 'telegram-outbound-outbox-a' }),
    );
  });

  it('allows the processor to claim a pending record whose nextAttemptAt is null', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = new TelegramOutboundProcessorService(
      config() as never,
      {
        client: {
          outboxRecord: {
            findUnique: vi.fn().mockResolvedValue({
              attempts: 0,
              connectionId: 'connection-a',
              id: 'outbox-a',
              kind: 'TELEGRAM',
              maxAttempts: 8,
              payload: { channelIdentityId: 'identity-a', messageId: 'message-a' },
              projectId: 'project-a',
              status: 'PENDING',
            }),
            updateMany,
          },
        },
      } as never,
      {
        close: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        waitUntilReady: vi.fn().mockResolvedValue(undefined),
      },
    );
    const internals = service as unknown as {
      claim(id: string): Promise<unknown>;
    };

    await expect(internals.claim('outbox-a')).resolves.toBeDefined();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            {
              status: { in: ['PENDING', 'RETRY'] },
              OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: expect.any(Date) } }],
            },
          ]),
        }),
      }),
    );
  });

  it('preserves the configured local wall clock across a daylight-saving transition', () => {
    const service = new TelegramOutboundProcessorService(
      config() as never,
      { client: {} } as never,
      {
        close: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        waitUntilReady: vi.fn().mockResolvedValue(undefined),
      },
    );
    const internals = service as unknown as {
      addZonedDays(date: Date, days: number, timezone: string): Date;
    };

    expect(
      internals.addZonedDays(new Date('2026-03-28T09:00:00.000Z'), 1, 'Europe/Berlin'),
    ).toEqual(new Date('2026-03-29T08:00:00.000Z'));
  });

  it('creates exactly one durable next occurrence for a recurring schedule', async () => {
    const service = new TelegramOutboundProcessorService(
      config() as never,
      { client: {} } as never,
      {
        close: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        waitUntilReady: vi.fn().mockResolvedValue(undefined),
      },
    );
    const transaction = {
      message: { create: vi.fn().mockResolvedValue({ id: 'message-b' }) },
      outboxRecord: { create: vi.fn().mockResolvedValue({ id: 'outbox-b' }) },
      scheduledMessage: {
        create: vi.fn().mockResolvedValue({ id: 'schedule-b' }),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const internals = service as unknown as {
      createNextScheduledOccurrence(
        transaction: unknown,
        scheduled: unknown,
        message: unknown,
      ): Promise<void>;
    };

    await internals.createNextScheduledOccurrence(
      transaction,
      {
        channelIdentityId: 'identity-a',
        connectionId: 'connection-a',
        contactId: 'contact-a',
        occurrence: 1,
        projectId: 'project-a',
        recurrence: { count: 3, frequency: 'DAILY', interval: 1 },
        request: { kind: 'TEXT' },
        scheduledAt: new Date('2026-03-28T09:00:00.000Z'),
        seriesId: 'series-a',
        timezone: 'Europe/Berlin',
      },
      {
        connectionId: 'connection-a',
        contactId: 'contact-a',
        content: { text: 'Stored content' },
        conversationId: 'conversation-a',
        mediaAssetId: null,
        metadata: {},
        projectId: 'project-a',
        type: 'TEXT',
      },
    );

    expect(transaction.outboxRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: 'scheduled-series-series-a-2',
          nextAttemptAt: new Date('2026-03-29T08:00:00.000Z'),
        }),
      }),
    );
    expect(transaction.scheduledMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ occurrence: 2, seriesId: 'series-a' }),
      }),
    );
  });
});
