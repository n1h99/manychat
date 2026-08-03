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
  activeVersion: { graph: ScenarioGraph; id: string } | null;
  draftVersion: { graph: ScenarioGraph; id: string } | null;
  versions: Array<{
    createdAt: string;
    graph: ScenarioGraph;
    id: string;
    publishedAt: string | null;
    status: string;
    version: number;
  }>;
}
export interface ScenarioExecution {
  completedAt: string | null;
  createdAt: string;
  currentNodeId: string | null;
  id: string;
  nodeExecutions: Array<{
    attempt: number;
    completedAt: string | null;
    errorSafe: unknown | null;
    inputSafe: unknown;
    nodeId: string;
    nodeType: string;
    outputSafe: unknown | null;
    delivery?: {
      messageId: string;
      messageStatus: string;
      outboxRecordId: string;
      outboxStatus: string;
    };
    startedAt: string | null;
    status: string;
  }>;
  status: string;
}

export type AutomationActivityStatus =
  'QUEUED' | 'RUNNING' | 'WAITING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface AutomationActivityFilters {
  page: number;
  pageSize: number;
  periodDays: 7 | 30 | 90;
  query: string | undefined;
  scenarioId: string | undefined;
  status: AutomationActivityStatus | undefined;
}

export interface AutomationActivitySnapshot {
  breakdown: {
    reasons: Array<{ count: number; label: string }>;
    scenarios: Array<{
      active: number;
      completed: number;
      id: string;
      name: string;
      problems: number;
      total: number;
    }>;
    statuses: Array<{ count: number; label: string; status: AutomationActivityStatus }>;
  };
  items: Array<{
    completedAt: string | null;
    contact: {
      displayName: string | null;
      email: string | null;
      id: string;
      phone: string | null;
      username: string | null;
    };
    createdAt: string;
    currentStep: { label: string; type: string } | null;
    durationMs: number | null;
    id: string;
    reason: string;
    scenario: { id: string; name: string; version: number };
    startedAt: string | null;
    status: AutomationActivityStatus;
    statusLabel: string;
    timeline: Array<{
      completedAt: string | null;
      label: string;
      nodeId: string;
      reason: string | null;
      startedAt: string | null;
      status: string;
    }>;
    updatedAt: string;
  }>;
  page: number;
  pageSize: number;
  periodDays: number;
  summary: { active: number; completed: number; problems: number; total: number; waiting: number };
  total: number;
  trend: Array<{ completed: number; date: string; problems: number; started: number }>;
  trendSampled: boolean;
}
export interface AutomationSimulationResult {
  completed: boolean;
  steps: Array<{
    nextNodeId?: string;
    nodeId: string;
    nodeType: string;
    reasonCode?: string;
    result: 'COMPLETED' | 'WAITING' | 'WOULD_EXECUTE';
    selectedOutput?: string;
  }>;
}
export interface ScenarioGraph {
  edges: Array<{
    condition?: { field: string; operator: string; value?: unknown };
    conditionGroup?: {
      combinator: 'AND' | 'OR';
      rules: Array<{ field: string; operator: string; value?: unknown }>;
    };
    from: string;
    id?: string;
    output?: string;
    priority?: number;
    to: string;
  }>;
  nodes: Array<{
    config?: Record<string, unknown>;
    id: string;
    position?: { x: number; y: number };
    type: string;
  }>;
}

export const emptyScenarioGraph: ScenarioGraph = {
  edges: [{ from: 'incoming', output: 'default', to: 'stop' }],
  nodes: [
    { config: {}, id: 'incoming', position: { x: 0, y: 100 }, type: 'INCOMING_MESSAGE' },
    { config: {}, id: 'stop', position: { x: 280, y: 100 }, type: 'STOP' },
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

export function useScenarioExecutions(projectId?: string, scenarioId?: string) {
  const { accessToken } = useAuth();
  return useQuery({
    enabled: Boolean(projectId && scenarioId && scenarioId !== 'new'),
    queryFn: () =>
      apiRequest<ScenarioExecution[]>(
        `/api/v1/projects/${projectId}/scenarios/${scenarioId}/executions`,
        {},
        accessToken,
      ),
    queryKey: ['scenario-executions', projectId, scenarioId],
  });
}

export function useAutomationActivity(
  projectId: string | undefined,
  filters: AutomationActivityFilters,
) {
  const { accessToken } = useAuth();
  const params = new URLSearchParams({
    page: String(filters.page),
    pageSize: String(filters.pageSize),
    periodDays: String(filters.periodDays),
  });
  if (filters.query) params.set('query', filters.query);
  if (filters.scenarioId) params.set('scenarioId', filters.scenarioId);
  if (filters.status) params.set('status', filters.status);
  return useQuery({
    enabled: Boolean(projectId),
    queryFn: () =>
      apiRequest<AutomationActivitySnapshot>(
        `/api/v1/projects/${projectId}/automation-activity?${params.toString()}`,
        {},
        accessToken,
      ),
    queryKey: ['automation-activity', projectId, filters, accessToken],
    refetchInterval: 15_000,
  });
}

export function useScenarioMutations(projectId?: string) {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  const invalidate = async () => {
    await client.invalidateQueries({ queryKey: ['scenarios', projectId] });
    await client.invalidateQueries({ queryKey: ['scenario', projectId] });
    await client.invalidateQueries({ queryKey: ['scenario-executions', projectId] });
  };
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
    pause: useMutation({
      mutationFn: (scenarioId: string) => request<Scenario>(`/${scenarioId}/pause`, 'POST'),
      onSuccess: invalidate,
    }),
    resume: useMutation({
      mutationFn: (scenarioId: string) => request<Scenario>(`/${scenarioId}/resume`, 'POST'),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (scenarioId: string) => request<Scenario>(`/${scenarioId}`, 'DELETE'),
      onSuccess: invalidate,
    }),
    restoreVersion: useMutation({
      mutationFn: ({ scenarioId, versionId }: { scenarioId: string; versionId: string }) =>
        request<Scenario>(`/${scenarioId}/versions/${versionId}/restore`, 'POST'),
      onSuccess: invalidate,
    }),
    replayExecution: useMutation({
      mutationFn: ({ executionId, scenarioId }: { executionId: string; scenarioId: string }) =>
        request<AutomationSimulationResult>(
          `/${scenarioId}/executions/${executionId}/replay`,
          'POST',
        ),
    }),
    testRun: useMutation({
      mutationFn: ({
        scenarioId,
        ...input
      }: {
        contact?: Record<string, unknown>;
        customFields?: Record<string, unknown>;
        event?: Record<string, unknown>;
        graph: ScenarioGraph;
        httpOutcome?: 'success' | 'failure';
        scenarioId: string;
        waitOutcome?: 'reply' | 'timeout';
      }) => request<AutomationSimulationResult>(`/${scenarioId}/test-run`, 'POST', input),
    }),
    update: useMutation({
      mutationFn: ({
        id,
        ...input
      }: {
        id: string;
        description?: string | null;
        expectedUpdatedAt?: string;
        graph?: ScenarioGraph;
        name?: string;
      }) => request<Scenario>(`/${id}`, 'PATCH', input),
      onSuccess: async (_data, variables) => {
        await client.invalidateQueries({ queryKey: ['scenarios', projectId] });
        await client.invalidateQueries({ queryKey: ['scenario', projectId, variables.id] });
      },
    }),
  };
}
