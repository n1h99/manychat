import { describe, expect, it, vi } from 'vitest';

import { ContactsService } from './contacts.service';

function service() {
  return new ContactsService({ record: vi.fn() } as never, { client: {} } as never);
}

describe('ContactsService v2', () => {
  it('lists archived custom fields separately and restores them safely', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const findUnique = vi.fn().mockResolvedValue({ archivedAt: new Date(), id: 'field-a' });
    const update = vi.fn().mockResolvedValue({ archivedAt: null, id: 'field-a' });
    const audit = { record: vi.fn() };
    const instance = new ContactsService(
      audit as never,
      {
        client: { customFieldDefinition: { findMany, findUnique, update } },
      } as never,
    );

    await instance.listCustomFields('project-a', true);
    await expect(
      instance.restoreCustomField('project-a', 'field-a', {
        actorEmail: 'operator@example.test',
        actorUserId: 'user-a',
        correlationId: 'test',
      }),
    ).resolves.toMatchObject({ archivedAt: null });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { archivedAt: { not: null }, projectId: 'project-a' },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'custom_field.restored' }),
    );
  });

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
