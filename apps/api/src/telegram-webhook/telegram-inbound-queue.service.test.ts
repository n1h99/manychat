import { describe, expect, it, vi } from 'vitest';

import {
  TELEGRAM_INBOUND_JOB_NAME,
  TelegramInboundQueueService,
  telegramInboundJobIdFor,
} from './telegram-inbound-queue.service';

describe('TelegramInboundQueueService', () => {
  it('uses a stable job ID and passes only inboxRecordId to BullMQ', async () => {
    const producer = {
      add: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const service = new TelegramInboundQueueService(
      { get: vi.fn().mockReturnValue('redis://127.0.0.1:6379/0') } as never,
      producer,
    );

    await service.enqueue('inbox-123');

    expect(telegramInboundJobIdFor('inbox-123')).toBe('telegram-inbound:inbox-123');
    expect(producer.add).toHaveBeenCalledWith(
      TELEGRAM_INBOUND_JOB_NAME,
      { inboxRecordId: 'inbox-123' },
      expect.objectContaining({
        attempts: 8,
        backoff: { delay: 1_000, type: 'exponential' },
        jobId: 'telegram-inbound:inbox-123',
        removeOnComplete: true,
        removeOnFail: true,
      }),
    );
  });
});
