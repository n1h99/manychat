import { useParams } from 'react-router';

import { hasProjectPermission, useProjectAccess } from '../project-access';
import { RoleManager } from '../role-manager';

export function ProjectRolesPage() {
  const { projectId } = useParams();
  const access = useProjectAccess(projectId);
  return (
    <RoleManager
      canManage={hasProjectPermission(access.data, 'members:manage')}
      description="Choose what project members can see and manage inside this workspace."
      permissionsPath={`/api/v1/projects/${projectId}/role-permissions`}
      queryKey={`project-role-manager-${projectId}`}
      rolesPath={`/api/v1/projects/${projectId}/roles`}
      title="Project roles"
    />
  );
}
