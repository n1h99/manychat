import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { TelegramOutboundProcessorService } from './telegram-outbound-processor.service';

const config = new ConfigService({
  APP_ENV: 'test',
  CHANNEL_SECRETS_KEY: Buffer.alloc(32, 9).toString('base64'),
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  MEDIA_SIGNED_URL_TTL_SECONDS: 300,
  MEDIA_STORAGE_ENABLED: false,
  REDIS_URL: 'redis://localhost:6379/0',
});

function service() {
  return new TelegramOutboundProcessorService(config as never, { client: {} } as never, {
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    waitUntilReady: vi.fn().mockResolvedValue(undefined),
  });
}

describe('Telegram outbound media references', () => {
  it('reuses a Telegram file_id only on the connection that owns it', async () => {
    const internals = service() as unknown as {
      mediaReference(
        asset: {
          bucketKey: string | null;
          connectionId: string | null;
          detectedMimeType: string | null;
          originalFilename: string | null;
          providerMediaId: string | null;
          status: string;
        },
        connectionId: string,
      ): Promise<string>;
    };

    await expect(
      internals.mediaReference(
        {
          bucketKey: null,
          connectionId: 'connection-a',
          detectedMimeType: null,
          originalFilename: null,
          providerMediaId: 'telegram-file-id',
          status: 'PROVIDER_REFERENCE',
        },
        'connection-a',
      ),
    ).resolves.toBe('telegram-file-id');
    await expect(
      internals.mediaReference(
        {
          bucketKey: null,
          connectionId: 'connection-a',
          detectedMimeType: null,
          originalFilename: null,
          providerMediaId: 'telegram-file-id',
          status: 'PROVIDER_REFERENCE',
        },
        'connection-b',
      ),
    ).rejects.toMatchObject({ code: 'telegram_outbound_media_unavailable' });
  });

  it('loads private bucket media for direct multipart upload', async () => {
    const internals = service() as unknown as {
      storage: {
        getObject(key: string): Promise<{ bytes: Uint8Array; contentType?: string }>;
      };
      mediaReference(
        asset: {
          bucketKey: string | null;
          connectionId: string | null;
          detectedMimeType: string | null;
          originalFilename: string | null;
          providerMediaId: string | null;
          status: string;
        },
        connectionId: string,
      ): Promise<unknown>;
    };
    internals.storage = {
      getObject: vi.fn().mockResolvedValue({
        bytes: Uint8Array.from([0xff, 0xd8, 0xff]),
        contentType: 'image/jpeg',
      }),
    };

    await expect(
      internals.mediaReference(
        {
          bucketKey: 'project/photo.jpg',
          connectionId: null,
          detectedMimeType: 'image/jpeg',
          originalFilename: 'photo.jpg',
          providerMediaId: null,
          status: 'AVAILABLE',
        },
        'connection-a',
      ),
    ).resolves.toEqual({
      bytes: Uint8Array.from([0xff, 0xd8, 0xff]),
      contentType: 'image/jpeg',
      filename: 'photo.jpg',
    });
  });
});
