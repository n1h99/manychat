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
});
