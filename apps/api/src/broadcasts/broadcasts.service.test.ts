import { describe, expect, it, vi } from 'vitest';

import { BroadcastsService } from './broadcasts.service';

function service(client: Record<string, unknown> = {}) {
  return new BroadcastsService(
    { record: vi.fn() } as never,
    { client } as never,
    { enqueue: vi.fn() } as never,
  );
}

describe('BroadcastsService', () => {
  it('rejects a selected-contact audience without contacts before persistence', async () => {
    await expect(
      service().create(
        'project-a',
        {
          audience: { mode: 'CONTACTS' },
          connectionId: 'connection-a',
          name: 'Campaign',
          text: 'Hello',
        },
        { actorEmail: 'operator@example.test', actorUserId: 'user-a', correlationId: 'test' },
      ),
    ).rejects.toMatchObject({
      response: { code: 'BROADCAST_CONTACTS_REQUIRED', message: 'Contacts are required' },
    });
  });

  it('rejects duplicate audience tag identifiers before persistence', async () => {
    await expect(
      service().create(
        'project-a',
        {
          audience: { includeTagIds: ['tag-a', 'tag-a'], mode: 'ALL_ACTIVE' },
          connectionId: 'connection-a',
          name: 'Campaign',
          text: 'Hello',
        },
        { actorEmail: 'operator@example.test', actorUserId: 'user-a', correlationId: 'test' },
      ),
    ).rejects.toMatchObject({
      response: { code: 'BROADCAST_TAGS_INVALID', message: 'Audience tags must be unique' },
    });
  });

  it('archives a stopped broadcast without deleting recipients', async () => {
    const row = {
      audience: {},
      cancelledAt: null,
      completedAt: null,
      connectionId: 'connection-a',
      content: { kind: 'TEXT', text: 'Hello' },
      createdAt: new Date(),
      errorCode: null,
      failedAt: null,
      id: 'broadcast-a',
      name: 'Campaign',
      pausedAt: null,
      projectId: 'project-a',
      scheduledAt: null,
      startedAt: null,
      status: 'COMPLETED',
      updatedAt: new Date(),
    };
    const update = vi.fn().mockResolvedValue({
      ...row,
      _count: { recipients: 3 },
      status: 'ARCHIVED',
    });
    const instance = service({
      broadcast: { findUnique: vi.fn().mockResolvedValue(row), update },
    });

    await expect(
      instance.archive('project-a', 'broadcast-a', {
        actorEmail: 'admin@example.test',
        actorUserId: 'user-a',
        correlationId: 'correlation-a',
      }),
    ).resolves.toMatchObject({ recipientCount: 3, status: 'ARCHIVED' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'ARCHIVED' } }));
  });

  it('requires an active broadcast to be stopped before archiving', async () => {
    const instance = service({
      broadcast: { findUnique: vi.fn().mockResolvedValue({ status: 'RUNNING' }) },
    });
    await expect(
      instance.archive('project-a', 'broadcast-a', {
        actorEmail: 'admin@example.test',
        actorUserId: 'user-a',
        correlationId: 'correlation-a',
      }),
    ).rejects.toMatchObject({ response: { code: 'BROADCAST_MUST_BE_STOPPED' } });
  });
});
