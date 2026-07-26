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

export interface CrmOperation {
  attempts: number;
  createdAt: string;
  id: string;
  lastError: string | null;
  resultSafe: unknown;
  status: 'FAILED' | 'PENDING' | 'PROCESSING' | 'RETRY' | 'SUCCEEDED' | 'UNKNOWN';
  type: 'CREATE_OR_UPDATE_LEAD' | 'FORWARD_INBOUND_MESSAGE';
  updatedAt: string;
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

export function useCrmOperations(projectId?: string) {
  const { accessToken } = useAuth();
  return useQuery({
    enabled: Boolean(projectId),
    queryFn: () =>
      apiRequest<CrmOperation[]>(`/api/v1/projects/${projectId}/crm-operations`, {}, accessToken),
    queryKey: ['crm-operations', projectId],
  });
}

export function useRetryCrmOperation(projectId?: string) {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { confirmUnknownDelivery: boolean; operationId: string }) =>
      apiRequest<CrmOperation>(
        `/api/v1/projects/${projectId}/crm-operations/${input.operationId}/retry`,
        {
          body: JSON.stringify({ confirmUnknownDelivery: input.confirmUnknownDelivery }),
          method: 'POST',
        },
        accessToken,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ['crm-operations', projectId] }),
  });
}
