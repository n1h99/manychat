import { ConfigService } from '@nestjs/config';
import { prepareMediaForTelegram } from '@omnicus/media-core';
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

  it('validates normalized photo bytes with their stored extension', async () => {
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
        kind: 'PHOTO',
      ): Promise<unknown>;
    };
    const originalPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGMQkdMQkdNggFAACZYBaWlFihUAAAAASUVORK5CYII=',
      'base64',
    );
    const normalizedJpeg = (
      await prepareMediaForTelegram({
        bytes: originalPng,
        declaredMimeType: 'image/png',
        filename: 'original-upload.png',
        kind: 'PHOTO',
        maximumBytes: 20 * 1024 * 1024,
      })
    ).bytes;
    internals.storage = {
      getObject: vi.fn().mockResolvedValue({
        bytes: normalizedJpeg,
        contentType: 'image/jpeg',
      }),
    };

    await expect(
      internals.mediaReference(
        {
          bucketKey: 'project/photo.jpg',
          connectionId: null,
          detectedMimeType: 'image/jpeg',
          extension: 'jpg',
          originalFilename: 'original-upload.png',
          providerMediaId: null,
          status: 'AVAILABLE',
        },
        'connection-a',
        'PHOTO',
      ),
    ).resolves.toMatchObject({
      contentType: 'image/jpeg',
      filename: 'original-upload.jpg',
    });
  });

  it.each([
    {
      bytes: new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n'),
      extension: 'pdf',
      kind: 'DOCUMENT' as const,
      mimeType: 'application/pdf',
    },
    {
      bytes: Uint8Array.from([
        0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ]),
      extension: 'zip',
      kind: 'DOCUMENT' as const,
      mimeType: 'application/zip',
    },
    {
      bytes: Uint8Array.from([0x49, 0x44, 0x33]),
      extension: 'mp3',
      kind: 'AUDIO' as const,
      mimeType: 'audio/mpeg',
    },
    {
      bytes: Uint8Array.from([0x4f, 0x67, 0x67, 0x53]),
      extension: 'ogg',
      kind: 'VOICE' as const,
      mimeType: 'audio/ogg',
    },
    {
      bytes: Uint8Array.from([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]),
      extension: 'mp4',
      kind: 'VIDEO' as const,
      mimeType: 'video/mp4',
    },
    {
      bytes: Uint8Array.from([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]),
      extension: 'mp4',
      kind: 'VIDEO_NOTE' as const,
      mimeType: 'video/mp4',
    },
    {
      bytes: new TextEncoder().encode('GIF89a'),
      extension: 'gif',
      kind: 'ANIMATION' as const,
      mimeType: 'image/gif',
    },
    {
      bytes: Uint8Array.from([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0, 0]),
      extension: 'tgs',
      kind: 'STICKER' as const,
      mimeType: 'application/x-tgsticker',
    },
  ])('loads and validates $kind .$extension uploads from private storage', async (fixture) => {
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
        kind: typeof fixture.kind,
      ): Promise<unknown>;
    };
    internals.storage = {
      getObject: vi.fn().mockResolvedValue({
        bytes: fixture.bytes,
        contentType: fixture.mimeType,
      }),
    };

    await expect(
      internals.mediaReference(
        {
          bucketKey: `project/upload.${fixture.extension}`,
          connectionId: null,
          detectedMimeType: fixture.mimeType,
          extension: fixture.extension,
          originalFilename: `upload.${fixture.extension}`,
          providerMediaId: null,
          status: 'AVAILABLE',
        },
        'connection-a',
        fixture.kind,
      ),
    ).resolves.toMatchObject({
      contentType: fixture.mimeType,
      filename: `upload.${fixture.extension}`,
    });
  });

  it('returns a safe, specific validation code without exposing media contents', async () => {
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
        kind: 'DOCUMENT',
      ): Promise<unknown>;
    };
    internals.storage = {
      getObject: vi.fn().mockResolvedValue({
        bytes: new TextEncoder().encode('not-a-pdf'),
        contentType: 'application/pdf',
      }),
    };

    await expect(
      internals.mediaReference(
        {
          bucketKey: 'project/upload.pdf',
          connectionId: null,
          detectedMimeType: 'application/pdf',
          extension: 'pdf',
          originalFilename: 'upload.pdf',
          providerMediaId: null,
          status: 'AVAILABLE',
        },
        'connection-a',
        'DOCUMENT',
      ),
    ).rejects.toMatchObject({
      code: 'telegram_outbound_media_type_rejected',
      message: 'Telegram outbound request cannot be retried',
    });
  });
});
