export const globalPermissions = [
  'projects:create',
  'projects:read',
  'users:manage',
  'users:read',
  'roles:manage',
] as const;

export const projectPermissions = [
  'project:read',
  'project:manage',
  'members:manage',
  'contacts:read',
  'contacts:manage',
  'automation:read',
  'automation:manage',
  'integrations:manage',
] as const;

export const allPermissionCodes = [...globalPermissions, ...projectPermissions] as const;

export const SUPER_ADMIN_ROLE = 'super-admin';

export const systemProjectRoles = [
  {
    name: 'Project Admin',
    normalizedName: 'project-admin',
    permissions: ['project:read', 'project:manage', 'members:manage'],
  },
  {
    name: 'Automation Editor',
    normalizedName: 'automation-editor',
    permissions: ['project:read', 'automation:read', 'automation:manage'],
  },
  {
    name: 'Integration Manager',
    normalizedName: 'integration-manager',
    permissions: ['project:read', 'integrations:manage'],
  },
  {
    name: 'Contact Manager',
    normalizedName: 'contact-manager',
    permissions: ['project:read', 'contacts:read', 'contacts:manage'],
  },
  {
    name: 'Viewer',
    normalizedName: 'viewer',
    permissions: ['project:read', 'contacts:read', 'automation:read'],
  },
] as const;
