import { describe, expect, it, vi } from 'vitest';

import { BroadcastsService } from './broadcasts.service';

function service() {
  return new BroadcastsService(
    { record: vi.fn() } as never,
    { client: {} } as never,
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
});
