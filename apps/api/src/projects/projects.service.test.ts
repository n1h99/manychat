import { describe, expect, it, vi } from 'vitest';

import { ProjectsService } from './projects.service';

const auth = {
  email: 'admin@example.test',
  globalPermissions: [],
  globalRoleNames: ['super-admin'],
  userId: 'user-a',
};

describe('ProjectsService lifecycle', () => {
  it('archives a project without deleting tenant history', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValue({ id: 'project-a', name: 'Project', status: 'ACTIVE' });
    const update = vi
      .fn()
      .mockResolvedValue({ id: 'project-a', name: 'Project', status: 'ARCHIVED' });
    const audit = { record: vi.fn() };
    const service = new ProjectsService(
      {} as never,
      audit as never,
      { client: { project: { findUnique, update } } } as never,
      {} as never,
    );

    await expect(
      service.archive('project-a', auth, { correlationId: 'correlation-a' }),
    ).resolves.toMatchObject({ status: 'ARCHIVED' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ARCHIVED' }, where: { id: 'project-a' } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project.archived', projectId: 'project-a' }),
    );
  });

  it('excludes archived projects from the workspace list', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new ProjectsService(
      {} as never,
      {} as never,
      { client: { project: { findMany } } } as never,
      {} as never,
    );

    await service.list(auth);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: 'ARCHIVED' } }),
      }),
    );
  });
});
