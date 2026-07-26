import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { PermissionGuard } from './permission.guard';

function executionContext(auth: unknown, projectId = 'project-a') {
  return {
    getClass: () => class TestController {},
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ auth, params: { projectId } }) }),
  } as never;
}

describe('PermissionGuard', () => {
  it('allows a Super Admin without a project membership', async () => {
    const access = { hasProjectPermission: vi.fn().mockResolvedValue(true) };
    const reflector = {
      getAllAndOverride: vi
        .fn()
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce('project:manage'),
    };
    const guard = new PermissionGuard(access as never, reflector as unknown as Reflector);

    await expect(
      guard.canActivate(
        executionContext({
          globalPermissions: [],
          globalRoleNames: ['super-admin'],
          userId: 'user-a',
        }),
      ),
    ).resolves.toBe(true);
  });

  it('rejects a Project Admin outside the requested project', async () => {
    const access = { hasProjectPermission: vi.fn().mockResolvedValue(false) };
    const reflector = {
      getAllAndOverride: vi
        .fn()
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce('project:manage'),
    };
    const guard = new PermissionGuard(access as never, reflector as unknown as Reflector);

    await expect(
      guard.canActivate(
        executionContext({ globalPermissions: [], globalRoleNames: [], userId: 'user-a' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
