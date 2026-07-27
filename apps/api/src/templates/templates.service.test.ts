import { describe, expect, it, vi } from 'vitest';

import { TemplatesService } from './templates.service';

const actor = {
  email: 'admin@example.test',
  globalPermissions: [],
  globalRoleNames: [],
  userId: 'user-a',
};
const context = { correlationId: 'correlation-a' };

describe('TemplatesService', () => {
  it('creates a versioned text draft inside one transaction', async () => {
    const transaction = {
      messageTemplate: {
        create: vi.fn().mockResolvedValue({ id: 'template-a' }),
        update: vi.fn().mockResolvedValue({ draftVersionId: 'version-a', id: 'template-a' }),
      },
      messageTemplateVersion: {
        create: vi.fn().mockResolvedValue({ id: 'version-a' }),
      },
    };
    const database = {
      client: {
        $transaction: vi.fn(async (callback: (client: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
        ),
      },
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new TemplatesService(database as never, audit as never);

    await service.create(
      'project-a',
      { kind: 'TEXT', name: 'Welcome', text: 'Hello {{contact.firstName}}' },
      actor,
      context,
    );

    expect(transaction.messageTemplateVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'project-a',
        templateId: 'template-a',
        variables: ['contact.firstName'],
        version: 1,
      }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'message_template.created',
        afterSafeJson: { kind: 'TEXT', version: 1 },
      }),
    );
  });

  it('keeps storage internals out of list queries', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new TemplatesService(
      { client: { messageTemplate: { findMany } } } as never,
      { record: vi.fn() } as never,
    );

    await service.list('project-a');

    const query = findMany.mock.calls[0]![0];
    expect(query.where.projectId).toBe('project-a');
    expect(query.include.activeVersion.include.mediaAsset.select).not.toHaveProperty('bucketKey');
    expect(query.include.draftVersion.include.mediaAsset.select).not.toHaveProperty('bucketKey');
  });

  it('previews variables without sending or mutating data', async () => {
    const service = new TemplatesService(
      {
        client: {
          messageTemplate: {
            findUnique: vi.fn().mockResolvedValue({
              activeVersion: null,
              draftVersion: {
                content: { text: 'Hello {{contact.firstName}}' },
                kind: 'TEXT',
                mediaAssetId: null,
              },
              id: 'template-a',
              status: 'DRAFT',
              versions: [],
            }),
          },
        },
      } as never,
      { record: vi.fn() } as never,
    );

    await expect(
      service.preview('project-a', 'template-a', {
        variables: { contact: { firstName: 'Eldar' } },
      }),
    ).resolves.toMatchObject({ missing: [], output: 'Hello Eldar' });
  });
});
