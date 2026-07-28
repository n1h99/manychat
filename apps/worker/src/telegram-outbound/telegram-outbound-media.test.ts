import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { TelegramOutboundProcessorService } from './telegram-outbound-processor.service';

const config = new ConfigService({
  APP_ENV: 'test',
  CHANNEL_SECRETS_KEY: Buffer.alloc(32, 9).toString('base64'),
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  MEDIA_MAX_UPLOAD_BYTES: 20 * 1024 * 1024,
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
          extension: string | null;
          originalFilename: string | null;
          providerMediaId: string | null;
          status: string;
        },
        connectionId: string,
        kind: 'DOCUMENT' | 'PHOTO',
      ): Promise<string>;
    };

    await expect(
      internals.mediaReference(
        {
          bucketKey: null,
          connectionId: 'connection-a',
          detectedMimeType: null,
          extension: null,
          originalFilename: null,
          providerMediaId: 'telegram-file-id',
          status: 'PROVIDER_REFERENCE',
        },
        'connection-a',
        'PHOTO',
      ),
    ).resolves.toBe('telegram-file-id');
    await expect(
      internals.mediaReference(
        {
          bucketKey: null,
          connectionId: 'connection-a',
          detectedMimeType: null,
          extension: null,
          originalFilename: null,
          providerMediaId: 'telegram-file-id',
          status: 'PROVIDER_REFERENCE',
        },
        'connection-b',
        'PHOTO',
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
          extension: string | null;
          originalFilename: string | null;
          providerMediaId: string | null;
          status: string;
        },
        connectionId: string,
        kind: 'DOCUMENT' | 'PHOTO',
      ): Promise<unknown>;
    };
    internals.storage = {
      getObject: vi.fn().mockResolvedValue({
        bytes: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGMQkdMQkdNggFAACZYBaWlFihUAAAAASUVORK5CYII=',
          'base64',
        ),
        contentType: 'image/png',
      }),
    };

    await expect(
      internals.mediaReference(
        {
          bucketKey: 'project/photo.jpg',
          connectionId: null,
          detectedMimeType: 'image/png',
          extension: 'png',
          originalFilename: 'photo.png',
          providerMediaId: null,
          status: 'AVAILABLE',
        },
        'connection-a',
        'PHOTO',
      ),
    ).resolves.toMatchObject({
      contentType: 'image/jpeg',
      filename: 'photo.jpg',
    });
    const result = (await internals.mediaReference(
      {
        bucketKey: 'project/photo.jpg',
        connectionId: null,
        detectedMimeType: 'image/png',
        extension: 'png',
        originalFilename: 'photo.png',
        providerMediaId: null,
        status: 'AVAILABLE',
      },
      'connection-a',
      'PHOTO',
    )) as { bytes: Uint8Array };
    expect([...result.bytes.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });
});
