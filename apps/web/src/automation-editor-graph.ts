import type { Edge, Node } from '@xyflow/react';

import type { ScenarioGraph } from './automation-api';

export type AutomationEdgeData = {
  condition?: { field: string; operator: string; value?: unknown };
  output?: string;
  priority?: number;
};

export function automationEdgeLabel(output?: string): string | undefined {
  if (!output || output === 'default') return undefined;
  const branch = /^branch-(\d+)$/i.exec(output);
  if (branch) return `Branch ${branch[1]}`;
  return output.replaceAll('_', ' ');
}

export function scenarioGraphToFlow(graph: ScenarioGraph): { edges: Edge[]; nodes: Node[] } {
  return {
    edges: graph.edges.map((edge, index) => ({
      data: {
        ...(edge.condition ? { condition: edge.condition } : {}),
        output: edge.output ?? 'default',
        ...(edge.priority === undefined ? {} : { priority: edge.priority }),
      },
      id: edge.id ?? `edge-${index}-${edge.from}-${edge.to}`,
      label: automationEdgeLabel(edge.output),
      source: edge.from,
      target: edge.to,
    })),
    nodes: graph.nodes.map((node) => ({
      data: { label: node.type },
      id: node.id,
      position: node.position ?? { x: 0, y: 0 },
      type: 'default',
    })),
  };
}

export function flowToScenarioGraph(
  nodes: Node[],
  edges: Edge[],
  configs: Record<string, Record<string, unknown>>,
): ScenarioGraph {
  return {
    edges: edges.map((edge) => {
      const data = (edge.data ?? {}) as AutomationEdgeData;
      return {
        ...(data.condition ? { condition: data.condition } : {}),
        from: edge.source,
        id: edge.id,
        output: data.output ?? (typeof edge.label === 'string' ? edge.label : 'default'),
        ...(data.priority === undefined ? {} : { priority: data.priority }),
        to: edge.target,
      };
    }),
    nodes: nodes.map((node) => ({
      config: configs[node.id] ?? {},
      id: node.id,
      position: node.position,
      type: String(node.data.label),
    })),
  };
}
