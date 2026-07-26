import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from './api';
import { useAuth } from './auth';

export type ScenarioStatus = 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'ARCHIVED';
export interface ScenarioSummary {
  activeVersionId: string | null;
  createdAt: string;
  description: string | null;
  id: string;
  name: string;
  status: ScenarioStatus;
  updatedAt: string;
}
export interface Scenario extends ScenarioSummary {
  draftVersion: { graph: ScenarioGraph; id: string } | null;
}
export interface ScenarioGraph {
  edges: Array<{ from: string; output?: string; priority?: number; to: string }>;
  nodes: Array<{ config?: Record<string, unknown>; id: string; type: string }>;
}

export const emptyScenarioGraph: ScenarioGraph = {
  edges: [{ from: 'incoming', output: 'default', to: 'stop' }],
  nodes: [
    { config: {}, id: 'incoming', type: 'INCOMING_MESSAGE' },
    { config: {}, id: 'stop', type: 'STOP' },
  ],
};

export function useScenarios(projectId?: string) {
  const { accessToken } = useAuth();
  return useQuery({
    enabled: Boolean(projectId),
    queryFn: () =>
      apiRequest<ScenarioSummary[]>(`/api/v1/projects/${projectId}/scenarios`, {}, accessToken),
    queryKey: ['scenarios', projectId],
  });
}

export function useScenario(projectId?: string, scenarioId?: string) {
  const { accessToken } = useAuth();
  return useQuery({
    enabled: Boolean(projectId && scenarioId),
    queryFn: () =>
      apiRequest<Scenario>(
        `/api/v1/projects/${projectId}/scenarios/${scenarioId}`,
        {},
        accessToken,
      ),
    queryKey: ['scenario', projectId, scenarioId],
  });
}

export function useScenarioMutations(projectId?: string) {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: ['scenarios', projectId] });
  const request = <T>(path: string, method: string, body?: unknown) =>
    apiRequest<T>(
      `/api/v1/projects/${projectId}/scenarios${path}`,
      { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
      accessToken,
    );
  return {
    create: useMutation({
      mutationFn: (input: { description?: string; graph: ScenarioGraph; name: string }) =>
        request<Scenario>('', 'POST', input),
      onSuccess: invalidate,
    }),
    publish: useMutation({
      mutationFn: (scenarioId: string) => request<Scenario>(`/${scenarioId}/publish`, 'POST'),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({
        id,
        ...input
      }: {
        id: string;
        description?: string;
        graph?: ScenarioGraph;
        name?: string;
      }) => request<Scenario>(`/${id}`, 'PATCH', input),
      onSuccess: invalidate,
    }),
  };
}
