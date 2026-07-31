import { describe, expect, it, vi } from 'vitest';

import { AutomationService } from './automation.service';

describe('AutomationService lifecycle', () => {
  it('archives a scenario and records a safe audit event', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      activeVersion: null,
      draftVersion: null,
      id: 'scenario-a',
      versions: [],
    });
    const update = vi.fn().mockResolvedValue({ id: 'scenario-a', status: 'ARCHIVED' });
    const audit = { record: vi.fn() };
    const service = new AutomationService(
      audit as never,
      {
        client: { scenario: { findUnique, update } },
      } as never,
    );

    await expect(
      service.archive(
        'project-a',
        'scenario-a',
        {
          email: 'admin@example.test',
          globalPermissions: [],
          globalRoleNames: [],
          userId: 'user-a',
        },
        { correlationId: 'correlation-a' },
      ),
    ).resolves.toMatchObject({ status: 'ARCHIVED' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'ARCHIVED' } }));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'scenario.archived', projectId: 'project-a' }),
    );
  });
});
