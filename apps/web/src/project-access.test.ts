import { describe, expect, it } from 'vitest';

import { hasProjectPermission } from './project-access';

describe('project channel access', () => {
  it('shows channel navigation only when channels.read is granted', () => {
    expect(
      hasProjectPermission(
        { permissions: ['channels:read'], projectRoleName: 'viewer' },
        'channels:read',
      ),
    ).toBe(true);
    expect(
      hasProjectPermission(
        { permissions: ['project:read'], projectRoleName: 'viewer' },
        'channels:read',
      ),
    ).toBe(false);
  });

  it('keeps manage and secret-rotation permissions distinct', () => {
    const access = {
      permissions: ['channels:read', 'channels:manage'],
      projectRoleName: 'project-admin',
    };

    expect(hasProjectPermission(access, 'channels:manage')).toBe(true);
    expect(hasProjectPermission(access, 'channels:rotate_secrets')).toBe(false);
  });

  it('keeps broadcast permissions separate from channel management', () => {
    const access = { permissions: ['broadcasts:read'], projectRoleName: 'viewer' };

    expect(hasProjectPermission(access, 'broadcasts:read')).toBe(true);
    expect(hasProjectPermission(access, 'broadcasts:launch')).toBe(false);
  });
});
