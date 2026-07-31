import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { TelegramOutboundProcessorService } from './telegram-outbound-processor.service';

const config = new ConfigService({
  APP_ENV: 'test',
  CHANNEL_SECRETS_KEY: Buffer.alloc(32, 9).toString('base64'),
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  MEDIA_MAX_UPLOAD_BYTES: 20 * 1024 * 1024,
  MEDIA_STORAGE_ENABLED: false,
  REDIS_URL: 'redis://localhost:6379/0',
});

describe('Telegram outbound v3 actions', () => {
  it('persists an edit only after the provider confirms it', async () => {
    const updateMessage = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      message: { updateMany: updateMessage },
      outboxRecord: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const service = new TelegramOutboundProcessorService(
      config as never,
      {
        client: {
          $transaction: (callback: (tx: typeof transaction) => unknown) => callback(transaction),
        },
      } as never,
      {
        close: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        waitUntilReady: vi.fn().mockResolvedValue(undefined),
      },
    );
    const editMessageText = vi.fn().mockResolvedValue(undefined);
    const internals = service as unknown as {
      adapter: { editMessageText: typeof editMessageText };
      executeMessageAction(
        token: string,
        claim: unknown,
        message: unknown,
        chatId: string,
      ): Promise<void>;
    };
    internals.adapter = { editMessageText };

    await internals.executeMessageAction(
      'secret',
      {
        attempts: 1,
        connectionId: 'connection-a',
        id: 'operation-a',
        lease: 'lease-a',
        maxAttempts: 8,
        payload: {
          action: 'EDIT_MESSAGE',
          channelIdentityId: 'identity-a',
          messageId: 'message-a',
          mutation: { text: 'Edited' },
          providerMessageId: '42',
        },
        projectId: 'project-a',
      },
      { content: { text: 'Before' }, id: 'message-a', metadata: {}, type: 'TEXT' },
      '123',
    );

    expect(editMessageText).toHaveBeenCalledWith('secret', {
      chatId: '123',
      messageId: '42',
      text: 'Edited',
    });
    expect(updateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: { text: 'Edited' },
          metadata: expect.objectContaining({ editedAt: expect.any(String) }),
        }),
      }),
    );
  });
});
