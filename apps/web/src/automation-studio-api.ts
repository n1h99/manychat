import { useQuery } from '@tanstack/react-query';

import { apiRequest } from './api';
import { useAuth } from './auth';

export interface AutomationTag {
  color: string | null;
  id: string;
  name: string;
}

export interface AutomationCustomField {
  id: string;
  key: string;
  name: string;
  options: string[] | null;
  type: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'DATETIME' | 'SELECT' | 'MULTI_SELECT' | 'JSON';
}

export function useAutomationTags(projectId?: string) {
  const { accessToken } = useAuth();
  return useQuery({
    enabled: Boolean(projectId),
    queryFn: () =>
      apiRequest<AutomationTag[]>(`/api/v1/projects/${projectId}/tags`, {}, accessToken),
    queryKey: ['tags', projectId, accessToken],
  });
}

export function useAutomationCustomFields(projectId?: string) {
  const { accessToken } = useAuth();
  return useQuery({
    enabled: Boolean(projectId),
    queryFn: () =>
      apiRequest<AutomationCustomField[]>(
        `/api/v1/projects/${projectId}/custom-fields?archived=false`,
        {},
        accessToken,
      ),
    queryKey: ['custom-fields', projectId, accessToken, 'active'],
  });
}
