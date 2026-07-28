import { describe, expect, it, vi } from 'vitest';

import { AccessService } from './access.service';

describe('AccessService project access', () => {
  it('accepts only an active, unexpired session for an active user', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: 'session-a' })
      .mockResolvedValueOnce(null);
    const service = new AccessService({
      client: { session: { findFirst } },
    } as never);

    await expect(service.isSessionActive('user-a', 'session-a')).resolves.toBe(true);
    await expect(service.isSessionActive('user-a', 'revoked-session')).resolves.toBe(false);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'session-a',
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
          userId: 'user-a',
        }),
      }),
    );
  });

  it('returns channel permissions assigned by a project role', async () => {
    const service = new AccessService({
      client: {
        globalUserRole: { findMany: vi.fn().mockResolvedValue([]) },
        projectMembership: {
          findUnique: vi.fn().mockResolvedValue({
            projectRole: {
              normalizedName: 'project-admin',
              permissions: [
                { permission: { code: 'project:read' } },
                { permission: { code: 'channels:read' } },
                { permission: { code: 'channels:manage' } },
                { permission: { code: 'channels:rotate_secrets' } },
              ],
            },
            status: 'ACTIVE',
          }),
        },
        user: { findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      },
    } as never);

    await expect(service.getProjectAccess('user-a', 'project-a')).resolves.toEqual({
      permissions: ['project:read', 'channels:read', 'channels:manage', 'channels:rotate_secrets'],
      projectRoleName: 'project-admin',
    });
  });

  it('gives Super Admin every project permission without a project membership', async () => {
    const service = new AccessService({
      client: {
        globalUserRole: {
          findMany: vi
            .fn()
            .mockResolvedValue([
              { globalRole: { normalizedName: 'super-admin', permissions: [] } },
            ]),
        },
        user: { findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      },
    } as never);

    await expect(service.getProjectAccess('user-a', 'project-a')).resolves.toEqual(
      expect.objectContaining({
        permissions: expect.arrayContaining([
          'channels:read',
          'channels:manage',
          'channels:rotate_secrets',
        ]),
        projectRoleName: null,
      }),
    );
  });
});
