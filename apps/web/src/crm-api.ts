import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from './api';
import { useAuth } from './auth';

export interface CrmProjectConfig {
  crmProjectId: string;
  defaultPipeline: string | null;
  defaultStage: string | null;
  enabled: boolean;
  fieldMapping: Record<string, unknown>;
}

export function useCrmProjectConfig(projectId?: string) {
  const { accessToken } = useAuth();
  return useQuery({
    enabled: Boolean(projectId),
    queryFn: () =>
      apiRequest<CrmProjectConfig | null>(
        `/api/v1/projects/${projectId}/crm-config`,
        {},
        accessToken,
      ),
    queryKey: ['crm-config', projectId],
  });
}

export function useSaveCrmProjectConfig(projectId?: string) {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CrmProjectConfig) =>
      apiRequest<CrmProjectConfig>(
        `/api/v1/projects/${projectId}/crm-config`,
        { body: JSON.stringify(input), method: 'PUT' },
        accessToken,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ['crm-config', projectId] }),
  });
}
