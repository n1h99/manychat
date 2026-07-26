import { randomBytes } from 'node:crypto';

import { ChannelSecretsService } from '@omnicus/channel-secrets';
import { describe, expect, it, vi } from 'vitest';

import { ChannelConnectionService } from './channel-connection.service';

describe('ChannelConnectionService', () => {
  it('decrypts and compares the webhook secret without returning plaintext', async () => {
    const key = randomBytes(32).toString('base64');
    const encrypted = new ChannelSecretsService(key).encryptSecret({
      channelConnectionId: 'connection-a',
      channelType: 'telegram',
      field: 'webhookSecret',
      plaintext: 'test-webhook-secret',
      projectId: 'project-a',
    });
    const client = {
      channelConnection: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'connection-a',
          projectId: 'project-a',
          status: 'ACTIVE',
          type: 'TELEGRAM',
          webhookSecretEncrypted: encrypted,
        }),
        update: vi.fn(),
      },
    };
    const service = new ChannelConnectionService(
      { get: vi.fn().mockReturnValue(key) } as never,
      { client } as never,
    );

    const connection = await service.findActiveTelegramConnection('connection-a');
    expect(await service.verifyWebhookSecret(connection, 'test-webhook-secret')).toBe(true);
    expect(await service.verifyWebhookSecret(connection, 'wrong')).toBe(false);
    expect(await service.verifyWebhookSecret(connection, undefined)).toBe(false);
    expect(JSON.stringify(connection)).not.toContain('test-webhook-secret');
  });

  it('does not expose disabled connections to the webhook path', async () => {
    const service = new ChannelConnectionService(
      { get: vi.fn().mockReturnValue(randomBytes(32).toString('base64')) } as never,
      {
        client: {
          channelConnection: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'connection-disabled',
              projectId: 'project-a',
              status: 'DISABLED',
              type: 'TELEGRAM',
              webhookSecretEncrypted: {},
            }),
          },
        },
      } as never,
    );

    await expect(service.findActiveTelegramConnection('connection-disabled')).rejects.toMatchObject(
      {
        status: 404,
      },
    );
  });
});
