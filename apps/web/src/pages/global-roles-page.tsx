import { RoleManager } from '../role-manager';

export function GlobalRolesPage() {
  return (
    <RoleManager
      description="Define reusable system access without changing immutable built-in roles."
      permissionsPath="/api/v1/roles/permissions"
      queryKey="global-role-manager"
      rolesPath="/api/v1/roles"
      title="System roles"
    />
  );
}
