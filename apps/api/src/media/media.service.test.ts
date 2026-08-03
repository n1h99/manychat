import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { MediaService } from './media.service';

const png = () => {
  const bytes = Buffer.alloc(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  bytes.writeUInt32BE(640, 16);
  bytes.writeUInt32BE(480, 20);
  return bytes;
};

function fixture() {
  const client = {
    mediaAsset: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const values: Record<string, unknown> = {
    CHANNEL_SECRETS_KEY: Buffer.alloc(32, 7).toString('base64'),
    MEDIA_MAX_UPLOAD_BYTES: 20 * 1024 * 1024,
    MEDIA_RETENTION_DAYS: 30,
    MEDIA_SIGNED_URL_TTL_SECONDS: 300,
    MEDIA_STORAGE_ENABLED: false,
  };
  const service = new MediaService(
    { get: (key: string) => values[key] } as never,
    { client } as never,
    { record: vi.fn() } as never,
  );
  Reflect.set(service, 'storage', { putObject: vi.fn() });
  return { client, service };
}

describe('MediaService provider validation metadata', () => {
  it('returns a normalized validation channel without leaking raw provider metadata', async () => {
    const { client, service } = fixture();
    client.mediaAsset.findMany.mockResolvedValue([
      {
        bucketKey: 'project-a/assets/whatsapp/asset-a.png',
        id: 'asset-a',
        projectId: 'project-a',
        providerMetadata: {
          temporaryProviderUrl: 'https://provider.invalid/private',
          validationChannel: 'whatsapp',
        },
        sizeBytes: 24n,
        source: 'USER_UPLOAD',
        status: 'AVAILABLE',
      },
    ]);

    await expect(service.list('project-a')).resolves.toEqual([
      expect.objectContaining({
        id: 'asset-a',
        sizeBytes: '24',
        validationChannel: 'whatsapp',
      }),
    ]);
    const result = (await service.list('project-a'))[0] as Record<string, unknown>;
    expect(result).not.toHaveProperty('bucketKey');
    expect(result).not.toHaveProperty('providerMetadata');
  });

  it('does not replay a Telegram-validated media id for a WhatsApp upload', async () => {
    const { client, service } = fixture();
    const buffer = png();
    client.mediaAsset.findUnique.mockResolvedValue({
      checksumSha256: createHash('sha256').update(buffer).digest('hex'),
      kind: 'PHOTO',
      providerMetadata: { validationChannel: 'telegram' },
      source: 'USER_UPLOAD',
      status: 'AVAILABLE',
    });

    await expect(
      service.uploadFromService(
        'project-a',
        'PHOTO',
        {
          buffer,
          mimetype: 'image/png',
          originalname: 'photo.png',
          size: buffer.length,
        },
        'same-request',
        'correlation-a',
        'whatsapp',
      ),
    ).rejects.toMatchObject({ response: { code: 'MEDIA_IDEMPOTENCY_CONFLICT' } });
    expect(client.mediaAsset.create).not.toHaveBeenCalled();
  });
});
