import { z } from 'zod';

export const automationNodeTypes = [
  'INCOMING_MESSAGE',
  'CONDITION',
  'ADD_TAG',
  'REMOVE_TAG',
  'SEND_MESSAGE',
  'CREATE_OR_UPDATE_LEAD',
  'FORWARD_TO_CRM',
  'SET_CUSTOM_FIELD',
  'DELAY',
  'WAIT_FOR_REPLY',
  'START_SUBFLOW',
  'PAUSE_AUTOMATION',
  'RESUME_AUTOMATION',
  'STOP',
] as const;

export type AutomationNodeType = (typeof automationNodeTypes)[number];

export const graphNodeSchema = z.object({
  config: z.record(z.string(), z.unknown()).default({}),
  id: z.string().min(1),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  type: z.enum(automationNodeTypes),
});

export const graphEdgeSchema = z.object({
  condition: z
    .object({
      field: z.string().min(1),
      operator: z.enum([
        'equals',
        'not_equals',
        'contains',
        'starts_with',
        'ends_with',
        'greater_than',
        'greater_or_equal',
        'less_than',
        'less_or_equal',
        'exists',
        'not_exists',
      ]),
      value: z.unknown().optional(),
    })
    .optional(),
  from: z.string().min(1),
  output: z.string().min(1).default('default'),
  priority: z.number().int().nonnegative().optional(),
  to: z.string().min(1),
});

export const scenarioGraphSchema = z.object({
  edges: z.array(graphEdgeSchema),
  nodes: z.array(graphNodeSchema).min(1),
});

export type ScenarioGraph = z.infer<typeof scenarioGraphSchema>;
export type ScenarioGraphNode = z.infer<typeof graphNodeSchema>;
export type ScenarioGraphEdge = z.infer<typeof graphEdgeSchema>;

export interface GraphValidationResult {
  errors: string[];
  warnings: string[];
}

const branchingNodes = new Set<AutomationNodeType>(['CONDITION']);
const continuationNodes = new Set<AutomationNodeType>(['DELAY', 'WAIT_FOR_REPLY']);

export function validateScenarioGraph(input: unknown): GraphValidationResult {
  const parsed = scenarioGraphSchema.safeParse(input);
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((issue) => issue.message), warnings: [] };
  }
  const graph = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, ScenarioGraphEdge[]>();
  for (const edge of graph.edges) {
    if (!nodesById.has(edge.from) || !nodesById.has(edge.to)) {
      errors.push(`Edge ${edge.from}:${edge.output}->${edge.to} references an unknown node`);
      continue;
    }
    const edges = outgoing.get(edge.from) ?? [];
    edges.push(edge);
    outgoing.set(edge.from, edges);
  }

  const triggers = graph.nodes.filter((node) => node.type === 'INCOMING_MESSAGE');
  if (triggers.length !== 1) {
    errors.push('A scenario must contain exactly one Incoming Message trigger');
  }
  for (const trigger of triggers) {
    if (!outgoing.get(trigger.id)?.length) {
      errors.push('Incoming Message trigger must have an outgoing path');
    }
  }
  for (const node of graph.nodes) {
    const edges = outgoing.get(node.id) ?? [];
    const ports = new Map<string, ScenarioGraphEdge[]>();
    for (const edge of edges) {
      const portEdges = ports.get(edge.output) ?? [];
      portEdges.push(edge);
      ports.set(edge.output, portEdges);
    }
    for (const [port, portEdges] of ports) {
      if (!branchingNodes.has(node.type) && portEdges.length > 1) {
        errors.push(`Node ${node.id} output ${port} has multiple active connections`);
      }
    }
    if (node.type === 'CONDITION') {
      const priorities = edges.map((edge) => edge.priority);
      if (priorities.some((priority) => priority === undefined)) {
        errors.push(`Condition node ${node.id} requires an explicit branch priority`);
      }
      if (new Set(priorities).size !== priorities.length) {
        errors.push(`Condition node ${node.id} has duplicate branch priorities`);
      }
    }
    if (node.type === 'DELAY') {
      const delaySeconds = node.config.delaySeconds;
      if (
        !Number.isInteger(delaySeconds) ||
        typeof delaySeconds !== 'number' ||
        delaySeconds <= 0
      ) {
        errors.push(`Delay node ${node.id} requires a positive integer delaySeconds`);
      }
    }
    if (node.type === 'WAIT_FOR_REPLY') {
      const timeoutSeconds = node.config.timeoutSeconds;
      if (
        !Number.isInteger(timeoutSeconds) ||
        typeof timeoutSeconds !== 'number' ||
        timeoutSeconds <= 0
      ) {
        errors.push(`Wait for Reply node ${node.id} requires a positive integer timeoutSeconds`);
      }
    }
    if (node.type === 'START_SUBFLOW' && typeof node.config.scenarioId !== 'string') {
      errors.push(`Subflow node ${node.id} requires a scenarioId`);
    }
  }

  const reachable = new Set<string>();
  const visit = (nodeId: string): void => {
    if (reachable.has(nodeId)) return;
    reachable.add(nodeId);
    for (const edge of outgoing.get(nodeId) ?? []) visit(edge.to);
  };
  for (const trigger of triggers) visit(trigger.id);
  for (const node of graph.nodes) {
    if (!reachable.has(node.id)) warnings.push(`Node ${node.id} is unreachable`);
  }
  if (hasUnguardedCycle(graph, outgoing, nodesById)) {
    errors.push('Graph contains an unguarded cycle');
  }
  return { errors, warnings };
}

function hasUnguardedCycle(
  graph: ScenarioGraph,
  outgoing: ReadonlyMap<string, ScenarioGraphEdge[]>,
  nodesById: ReadonlyMap<string, ScenarioGraphNode>,
): boolean {
  const visiting: string[] = [];
  const visited = new Set<string>();
  const visit = (nodeId: string): boolean => {
    const cycleStart = visiting.indexOf(nodeId);
    if (cycleStart >= 0) {
      return !visiting
        .slice(cycleStart)
        .some((cycleNodeId) => continuationNodes.has(nodesById.get(cycleNodeId)!.type));
    }
    if (visited.has(nodeId)) return false;
    visiting.push(nodeId);
    for (const edge of outgoing.get(nodeId) ?? []) {
      if (visit(edge.to)) return true;
    }
    visiting.pop();
    visited.add(nodeId);
    return false;
  };
  return graph.nodes.some((node) => visit(node.id));
}

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'greater_or_equal'
  | 'less_than'
  | 'less_or_equal'
  | 'exists'
  | 'not_exists';

export function evaluateCondition(
  operator: ConditionOperator,
  actual: unknown,
  expected: unknown,
): boolean {
  if (operator === 'exists') return actual !== null && actual !== undefined;
  if (operator === 'not_exists') return actual === null || actual === undefined;
  if (actual === null || actual === undefined || expected === null || expected === undefined) {
    return operator === 'not_equals' && actual !== expected;
  }
  switch (operator) {
    case 'equals':
      return actual === expected;
    case 'not_equals':
      return actual !== expected;
    case 'contains':
      return (
        typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected)
      );
    case 'starts_with':
      return (
        typeof actual === 'string' && typeof expected === 'string' && actual.startsWith(expected)
      );
    case 'ends_with':
      return (
        typeof actual === 'string' && typeof expected === 'string' && actual.endsWith(expected)
      );
    case 'greater_than':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'greater_or_equal':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'less_than':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'less_or_equal':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
  }
}
