import { describe, expect, it, vi } from 'vitest';

import { ChannelsService } from './channels.service';

describe('ChannelsService identity picker', () => {
  it('returns safe Telegram identities scoped to the selected project and connection', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
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
          channelIdentity: { findMany },
        },
      } as never,
      { record: vi.fn() } as never,
      { enqueue: vi.fn() } as never,
    );

    await expect(service.identities('project-a', 'connection-a')).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          connection: true,
          metadata: true,
        }),
        where: {
          channel: 'TELEGRAM',
          connectionId: 'connection-a',
          projectId: 'project-a',
        },
      }),
    );
  });
});
