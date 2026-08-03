import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from './api';
import { useAuth } from './auth';

export interface CrmProjectConfig {
  baseUrl: string | null;
  capabilities: Record<string, unknown>;
  crmProjectId: string;
  defaultPipeline: string | null;
  defaultStage: string | null;
  enabled: boolean;
  fieldMapping: Record<string, unknown>;
  lastErrorAt: string | null;
  lastTestedAt: string | null;
  paired: boolean;
  provider: 'CYBER_PULSE';
  status: 'DRAFT' | 'PAIRING' | 'ACTIVE' | 'DISABLED' | 'ERROR';
}

export interface CrmPairing {
  expiresAt: string;
  omnicusApiUrl: string;
  pairingCode: string;
}

export interface CrmOperation {
  attempts: number;
  createdAt: string;
  id: string;
  lastError: string | null;
  resultSafe: unknown;
  status: 'FAILED' | 'PENDING' | 'PROCESSING' | 'RETRY' | 'SUCCEEDED' | 'UNKNOWN';
  type:
    | 'CREATE_OR_UPDATE_LEAD'
    | 'FORWARD_INBOUND_MESSAGE'
    | 'FORWARD_OUTBOUND_MESSAGE'
    | 'FORWARD_REACTION_EVENT';
  updatedAt: string;
}

interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
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
    mutationFn: (input: {
      crmProjectId: string;
      defaultPipeline: string | null;
      defaultStage: string | null;
      enabled: boolean;
      fieldMapping: Record<string, unknown>;
    }) =>
      apiRequest<CrmProjectConfig>(
        `/api/v1/projects/${projectId}/crm-config`,
        { body: JSON.stringify(input), method: 'PUT' },
        accessToken,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ['crm-config', projectId] }),
  });
}

export function useCrmConnectionMutations(projectId?: string) {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: ['crm-config', projectId] });
  return {
    disable: useMutation({
      mutationFn: () =>
        apiRequest<CrmProjectConfig>(
          `/api/v1/projects/${projectId}/crm-config/disable`,
          { method: 'POST' },
          accessToken,
        ),
      onSuccess: invalidate,
    }),
    pairing: useMutation({
      mutationFn: (crmProjectId: string) =>
        apiRequest<CrmPairing>(
          `/api/v1/projects/${projectId}/crm-config/pairing`,
          { body: JSON.stringify({ crmProjectId }), method: 'POST' },
          accessToken,
        ),
      onSuccess: invalidate,
    }),
    test: useMutation({
      mutationFn: () =>
        apiRequest<{ ok: boolean; status: CrmProjectConfig['status'] }>(
          `/api/v1/projects/${projectId}/crm-config/test`,
          { method: 'POST' },
          accessToken,
        ),
      onSuccess: invalidate,
    }),
  };
}

export function useCrmOperations(projectId?: string, page = 1, pageSize = 10) {
  const { accessToken } = useAuth();
  return useQuery({
    enabled: Boolean(projectId),
    queryFn: () =>
      apiRequest<Paged<CrmOperation>>(
        `/api/v1/projects/${projectId}/crm-operations?page=${page}&pageSize=${pageSize}`,
        {},
        accessToken,
      ),
    queryKey: ['crm-operations', projectId, page],
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
