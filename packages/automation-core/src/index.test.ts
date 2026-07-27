import { describe, expect, it } from 'vitest';

import { evaluateCondition, validateScenarioGraph } from './index';

describe('automation graph validation', () => {
  it('requires deterministic condition branch priorities', () => {
    const result = validateScenarioGraph({
      edges: [
        { from: 'trigger', to: 'condition' },
        { from: 'condition', output: 'true', priority: 0, to: 'stop-a' },
        { from: 'condition', output: 'false', priority: 0, to: 'stop-b' },
      ],
      nodes: [
        { id: 'trigger', type: 'INCOMING_MESSAGE' },
        { id: 'condition', type: 'CONDITION' },
        { id: 'stop-a', type: 'STOP' },
        { id: 'stop-b', type: 'STOP' },
      ],
    });
    expect(result.errors).toContain('Condition node condition has duplicate branch priorities');
  });

  it('does not coerce null or strings to numbers', () => {
    expect(evaluateCondition('greater_than', null, 1)).toBe(false);
    expect(evaluateCondition('greater_than', '2', 1)).toBe(false);
    expect(evaluateCondition('greater_than', 2, 1)).toBe(true);
  });

  it('accepts a cycle guarded by a durable delay', () => {
    const result = validateScenarioGraph({
      edges: [
        { from: 'trigger', to: 'delay' },
        { from: 'delay', to: 'condition' },
        { from: 'condition', output: 'default', priority: 0, to: 'delay' },
      ],
      nodes: [
        { id: 'trigger', type: 'INCOMING_MESSAGE' },
        { config: { delaySeconds: 5 }, id: 'delay', type: 'DELAY' },
        { id: 'condition', type: 'CONDITION' },
      ],
    });
    expect(result.errors).not.toContain('Graph contains an unguarded cycle');
  });

  it('rejects a delay without an explicit positive duration', () => {
    const result = validateScenarioGraph({
      edges: [{ from: 'trigger', to: 'delay' }],
      nodes: [
        { id: 'trigger', type: 'INCOMING_MESSAGE' },
        { id: 'delay', type: 'DELAY' },
      ],
    });
    expect(result.errors).toContain('Delay node delay requires a positive integer delaySeconds');
  });

  it('requires pinned versions for templates and subflows', () => {
    const result = validateScenarioGraph({
      edges: [
        { from: 'trigger', to: 'template' },
        { from: 'template', to: 'subflow' },
      ],
      nodes: [
        { id: 'trigger', type: 'INCOMING_MESSAGE' },
        { config: { templateId: 'template-a' }, id: 'template', type: 'SEND_TEMPLATE' },
        { config: { scenarioId: 'scenario-a' }, id: 'subflow', type: 'START_SUBFLOW' },
      ],
    });

    expect(result.errors).toContain(
      'Send Template node template requires a pinned template version',
    );
    expect(result.errors).toContain(
      'Subflow node subflow requires a pinned published scenario version',
    );
  });
});
