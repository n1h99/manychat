import { describe, expect, it, vi } from 'vitest';

import { ChannelsService } from './channels.service';

describe('ChannelsService inbound diagnostics', () => {
  it('returns only safe project-scoped processing metadata', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        correlationId: 'correlation-a',
        externalUpdateId: '1001',
        inboxRecord: {
          attempts: 1,
          completedAt: null,
          lastError: 'telegram_inbound_processing_failed',
          maxAttempts: 8,
          nextAttemptAt: new Date('2026-07-28T10:00:00.000Z'),
          normalizedEvent: null,
          status: 'RETRY',
        },
        receivedAt: new Date('2026-07-28T09:59:00.000Z'),
        status: 'RECEIVED',
      },
    ]);
    const service = new ChannelsService(
      {
        get: vi.fn((name: string) =>
          name === 'CHANNEL_SECRETS_KEY'
            ? Buffer.alloc(32, 7).toString('base64')
            : 'https://api.example.test',
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
          rawWebhookEvent: { count: vi.fn().mockResolvedValue(1), findMany },
        },
      } as never,
      { record: vi.fn() } as never,
      { enqueue: vi.fn() } as never,
      {} as never,
    );

    await expect(
      service.inboundEvents('project-a', 'connection-a', { page: 1, pageSize: 20 }),
    ).resolves.toMatchObject({
      total: 1,
      items: [{ correlationId: 'correlation-a', status: 'RECEIVED' }],
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({ payload: true }),
        take: 20,
        where: { connectionId: 'connection-a', projectId: 'project-a' },
      }),
    );
  });

  it('accepts a project-scoped WhatsApp connection for inbound diagnostics', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new ChannelsService(
      {
        get: vi.fn((name: string) =>
          name === 'CHANNEL_SECRETS_KEY'
            ? Buffer.alloc(32, 7).toString('base64')
            : 'https://api.example.test',
        ),
      } as never,
      {
        client: {
          channelConnection: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'connection-whatsapp',
              projectId: 'project-a',
              type: 'WHATSAPP',
            }),
          },
          rawWebhookEvent: { count: vi.fn().mockResolvedValue(0), findMany },
        },
      } as never,
      { record: vi.fn() } as never,
      { enqueue: vi.fn() } as never,
      {} as never,
    );

    await expect(
      service.inboundEvents('project-a', 'connection-whatsapp', { page: 1, pageSize: 20 }),
    ).resolves.toMatchObject({ items: [] });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { connectionId: 'connection-whatsapp', projectId: 'project-a' },
      }),
    );
  });
});
