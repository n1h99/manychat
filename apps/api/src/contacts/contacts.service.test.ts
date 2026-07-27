import { describe, expect, it, vi } from 'vitest';

import { ContactsService } from './contacts.service';

function service() {
  return new ContactsService({ record: vi.fn() } as never, { client: {} } as never);
}

describe('ContactsService v2', () => {
  it('rejects a merge request where primary and secondary are identical', async () => {
    await expect(
      service().merge(
        'project-a',
        { primaryContactId: 'contact-a', secondaryContactId: 'contact-a' },
        { actorEmail: 'operator@example.test', actorUserId: 'user-a', correlationId: 'test' },
      ),
    ).rejects.toMatchObject({
      response: { code: 'CONTACT_MERGE_IDENTICAL', message: 'Contacts must be different' },
    });
  });

  it('rejects a segment filter with unsupported predicates before it reaches persistence', async () => {
    await expect(
      service().createSegment(
        'project-a',
        { filter: { arbitrarySql: 'nope' }, name: 'Unsafe' },
        { actorEmail: 'operator@example.test', actorUserId: 'user-a', correlationId: 'test' },
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'SEGMENT_FILTER_INVALID',
        message: 'Segment filter contains an unsupported predicate',
      },
    });
  });
});
