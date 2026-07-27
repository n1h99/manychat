import { describe, expect, it } from 'vitest';

import { flowToScenarioGraph, scenarioGraphToFlow } from './automation-editor-graph';
import type { ScenarioGraph } from './automation-api';

describe('automation editor graph mapping', () => {
  it('round-trips branch metadata and pinned node configuration', () => {
    const graph: ScenarioGraph = {
      edges: [
        {
          condition: { field: 'message.text', operator: 'contains', value: 'yes' },
          from: 'condition',
          id: 'edge-a',
          output: 'accepted',
          priority: 0,
          to: 'template',
        },
      ],
      nodes: [
        { config: {}, id: 'condition', position: { x: 10, y: 20 }, type: 'CONDITION' },
        {
          config: { templateId: 'template-a', templateVersionId: 'version-a' },
          id: 'template',
          position: { x: 30, y: 40 },
          type: 'SEND_TEMPLATE',
        },
      ],
    };
    const flow = scenarioGraphToFlow(graph);
    const restored = flowToScenarioGraph(
      flow.nodes,
      flow.edges,
      Object.fromEntries(graph.nodes.map((node) => [node.id, node.config ?? {}])),
    );

    expect(restored).toEqual(graph);
  });
});
