import { describe, expect, it, vi } from 'vitest';

import { ChannelsService } from './channels.service';

describe('ChannelsService outbound diagnostics', () => {
  it('returns safe project-scoped status without the outbox payload', async () => {
    const service = new ChannelsService(
      {
        get: vi.fn((name: string) =>
          name === 'CHANNEL_SECRETS_KEY' ? Buffer.alloc(32, 7).toString('base64') : undefined,
        ),
      } as never,
      {
        client: {
          channelConnection: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'connection-a',
              projectId: 'project-a',
              type: 'TELEGRAM',
            }),
          },
          message: {
            findMany: vi.fn().mockResolvedValue([
              {
                externalMessageId: null,
                failedAt: null,
                id: 'message-a',
                sentAt: null,
                status: 'QUEUED',
                type: 'TEXT',
              },
            ]),
          },
          outboxRecord: {
            findMany: vi.fn().mockResolvedValue([
              {
                attempts: 2,
                completedAt: null,
                createdAt: new Date('2026-07-28T10:00:00.000Z'),
                id: 'outbox-a',
                lastError: 'telegram_outbound_retryable',
                maxAttempts: 8,
                nextAttemptAt: new Date('2026-07-28T10:01:00.000Z'),
                payload: {
                  messageId: 'message-a',
                  secret: 'must-not-leak',
                  text: 'must-not-leak',
                },
                status: 'RETRY',
                updatedAt: new Date('2026-07-28T10:00:30.000Z'),
              },
            ]),
          },
        },
      } as never,
      { record: vi.fn() } as never,
      { enqueue: vi.fn() } as never,
    );

    const [result] = await service.outboundEvents('project-a', 'connection-a');

    expect(result).toMatchObject({
      id: 'outbox-a',
      message: { id: 'message-a', status: 'QUEUED' },
      status: 'RETRY',
    });
    expect(result).not.toHaveProperty('payload');
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });
});
