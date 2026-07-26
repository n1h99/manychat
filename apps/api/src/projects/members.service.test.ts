import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { MembersService } from './members.service';

const actor = {
  email: 'admin@example.test',
  globalPermissions: [],
  globalRoleNames: [],
  userId: 'admin',
};
const context = { correlationId: 'test' };

describe('MembersService tenant checks', () => {
  it('does not accept a role from another project', async () => {
    const database = {
      client: { projectRole: { findUnique: vi.fn().mockResolvedValue(null) } },
    };
    const service = new MembersService({ record: vi.fn() } as never, database as never);

    await expect(
      service.add('project-a', { projectRoleId: 'role-b', userId: 'user-b' }, actor, context),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('prevents deleting the last active Project Admin', async () => {
    const database = {
      client: {
        projectMembership: {
          count: vi.fn().mockResolvedValue(1),
          findUnique: vi.fn().mockResolvedValue({
            id: 'membership-a',
            projectId: 'project-a',
            projectRoleId: 'role-a',
            userId: 'user-a',
          }),
        },
        projectRole: { findUnique: vi.fn().mockResolvedValue({ normalizedName: 'project-admin' }) },
      },
    };
    const service = new MembersService({ record: vi.fn() } as never, database as never);

    await expect(
      service.remove('project-a', 'membership-a', actor, context),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
