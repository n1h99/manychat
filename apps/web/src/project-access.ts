import { useQuery } from '@tanstack/react-query';

import { apiRequest } from './api';
import { useAuth } from './auth';

export interface ProjectAccess {
  permissions: string[];
  projectRoleName: string | null;
}

export function hasProjectPermission(
  access: ProjectAccess | undefined,
  permission: string,
): boolean {
  return access?.permissions.includes(permission) ?? false;
}

export function useProjectAccess(projectId?: string) {
  const { accessToken, identity } = useAuth();
  return useQuery({
    enabled: Boolean(projectId && accessToken && identity),
    queryFn: () =>
      apiRequest<ProjectAccess>(`/api/v1/projects/${projectId}/access`, {}, accessToken),
    queryKey: ['project-access', identity?.userId, projectId],
  });
}
