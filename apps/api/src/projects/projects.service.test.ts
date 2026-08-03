import { describe, expect, it, vi } from 'vitest';

import { ProjectsService } from './projects.service';

const auth = {
  email: 'admin@example.test',
  globalPermissions: [],
  globalRoleNames: ['super-admin'],
  userId: 'user-a',
};

describe('ProjectsService lifecycle', () => {
  it('clones only safe project settings and custom role definitions', async () => {
    const source = {
      createdAt: new Date(),
      description: 'Workspace',
      id: 'project-a',
      locale: 'en',
      name: 'Source',
      settings: { appearance: 'soft' },
      slug: 'source',
      status: 'ACTIVE',
      timezone: 'UTC',
      updatedAt: new Date(),
    };
    const clone = { ...source, id: 'project-b', name: 'Clone', slug: 'clone', status: 'DRAFT' };
    const projectFindUnique = vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(null);
    const createProject = vi.fn().mockResolvedValue(clone);
    const transaction = {
      auditLog: { create: vi.fn() },
      project: { create: createProject },
      projectMembership: { create: vi.fn() },
      projectRole: { create: vi.fn() },
      projectRolePermission: { createMany: vi.fn() },
    };
    const roles = {
      ensureForProject: vi.fn().mockResolvedValue(new Map([['project-admin', 'role-a']])),
    };
    const service = new ProjectsService(
      {} as never,
      {} as never,
      {
        client: {
          $transaction: vi.fn(async (callback) => callback(transaction)),
          project: { findUnique: projectFindUnique },
          projectRole: { findMany: vi.fn().mockResolvedValue([]) },
        },
      } as never,
      roles as never,
    );

    await service.clone('project-a', { name: 'Clone', slug: 'clone' }, auth, {
      correlationId: 'correlation-a',
    });

    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          description: 'Workspace',
          locale: 'en',
          name: 'Clone',
          settings: { appearance: 'soft' },
          slug: 'clone',
          status: 'DRAFT',
          timezone: 'UTC',
        },
      }),
    );
    expect(transaction.projectMembership.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'user-a' }) }),
    );
    expect(transaction).not.toHaveProperty('channelConnection');
    expect(transaction).not.toHaveProperty('contact');
  });

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

  it('returns a safe project overview from authoritative counts', async () => {
    const project = {
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      description: null,
      id: 'project-a',
      locale: 'en',
      name: 'Project',
      settings: {},
      slug: 'project',
      status: 'ACTIVE',
      timezone: 'UTC',
      updatedAt: new Date('2026-08-03T00:00:00.000Z'),
    };
    const service = new ProjectsService(
      {} as never,
      {} as never,
      {
        client: {
          broadcast: { count: vi.fn().mockResolvedValue(2) },
          channelConnection: {
            groupBy: vi.fn().mockResolvedValue([
              { _count: { _all: 2 }, status: 'ACTIVE' },
              { _count: { _all: 1 }, status: 'ERROR' },
            ]),
          },
          contact: { count: vi.fn().mockResolvedValue(18) },
          outboxRecord: {
            groupBy: vi.fn().mockResolvedValue([
              { _count: { _all: 3 }, status: 'FAILED' },
              { _count: { _all: 1 }, status: 'UNKNOWN' },
            ]),
          },
          project: { findUnique: vi.fn().mockResolvedValue(project) },
          projectMembership: { count: vi.fn().mockResolvedValue(4) },
          scenario: { count: vi.fn().mockResolvedValue(5) },
        },
      } as never,
      {} as never,
    );

    await expect(service.overview('project-a', auth)).resolves.toMatchObject({
      activeBroadcasts: 2,
      channels: { active: 2, errors: 1, total: 3 },
      contacts: 18,
      members: 4,
      operationsNeedingAttention: { failed: 3, total: 4, unknown: 1 },
      publishedAutomations: 5,
    });
  });
});
