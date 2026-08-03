import { RoleManager } from '../role-manager';

export function GlobalRolesPage() {
  return (
    <RoleManager
      description="Choose what each group of system users can see and manage. Built-in roles stay protected."
      permissionsPath="/api/v1/roles/permissions"
      queryKey="global-role-manager"
      rolesPath="/api/v1/roles"
      title="System roles"
    />
  );
}
