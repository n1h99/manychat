import { describe, expect, it, vi } from 'vitest';

import { AccessService } from './access.service';

describe('AccessService project access', () => {
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
