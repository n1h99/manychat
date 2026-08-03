import { describe, expect, it } from 'vitest';

import {
  automationActionErrorMessage,
  automationEditorSignature,
  automationNodeLabel,
  conditionFieldType,
  durationParts,
  durationSeconds,
  externalHttpSafeErrorMessage,
  humanizeAutomationValidationIssue,
  normalizeScenarioDescription,
  previewAutomationText,
  safeDiagnosticJson,
  validateAutomationResources,
} from './automation-studio';

describe('Automation Studio helpers', () => {
  it('round-trips human-readable duration units to integer seconds', () => {
    expect(durationParts(7_200)).toEqual({ unit: 'hours', value: 2 });
    expect(durationParts(90)).toEqual({ unit: 'seconds', value: 90 });
    expect(durationSeconds(3, 'days')).toBe(259_200);
  });

  it('resolves custom-field types for typed condition values', () => {
    expect(
      conditionFieldType('contact.customFields.score', [
        { id: 'field-a', key: 'score', name: 'Score', options: null, type: 'NUMBER' },
      ]),
    ).toBe('NUMBER');
    expect(conditionFieldType('message.text', [])).toBe('TEXT');
  });

  it('does not render empty diagnostic objects', () => {
    expect(safeDiagnosticJson({})).toBeUndefined();
    expect(safeDiagnosticJson({ nextNodeId: 'send' })).toContain('nextNodeId');
  });

  it('previews supported variables and reports unknown paths', () => {
    expect(previewAutomationText('Hello {{contact.firstName}} {{contact.missing}}', [])).toEqual({
      missing: ['contact.missing'],
      output: 'Hello Alex ',
    });
  });

  it('renders human automation labels and validation issues', () => {
    expect(automationNodeLabel('EXTERNAL_HTTP_REQUEST')).toBe('External HTTP request');
    expect(
      humanizeAutomationValidationIssue('Node delay-a is unreachable', [
        { id: 'delay-a', type: 'DELAY' },
      ]),
    ).toEqual({ message: 'Delay is not connected to the trigger.', nodeId: 'delay-a' });
  });

  it('maps external HTTP safety codes without exposing provider details', () => {
    expect(externalHttpSafeErrorMessage('external_http_target_forbidden')).toContain(
      'private or restricted',
    );
  });

  it('uses a semantic editor signature and normalizes an empty optional description', () => {
    const first = {
      edges: [{ from: 'incoming', id: 'react-flow-a', output: 'default', to: 'stop' }],
      nodes: [
        { config: {}, id: 'stop', position: { x: 20, y: 20 }, type: 'STOP' },
        { config: {}, id: 'incoming', position: { x: 0, y: 0 }, type: 'INCOMING_MESSAGE' },
      ],
    };
    const second = {
      edges: [{ from: 'incoming', id: 'server-hydrated-b', output: 'default', to: 'stop' }],
      nodes: [...first.nodes].reverse(),
    };

    expect(automationEditorSignature(first, 'Test', '')).toBe(
      automationEditorSignature(second, 'Test', undefined),
    );
    expect(normalizeScenarioDescription('', false)).toBeUndefined();
    expect(normalizeScenarioDescription('   ', true)).toBeNull();
  });

  it('finds stale project resources before publish or safe test', () => {
    const issues = validateAutomationResources(
      {
        edges: [{ from: 'incoming', id: 'edge-a', to: 'set' }],
        nodes: [
          { id: 'incoming', type: 'INCOMING_MESSAGE' },
          { config: { key: 'archived' }, id: 'set', type: 'SET_CUSTOM_FIELD' },
        ],
      },
      { customFields: [] },
    );

    expect(issues).toEqual([{ message: 'Select an available custom field.', nodeId: 'set' }]);
    expect(automationActionErrorMessage({ code: 'SCENARIO_CUSTOM_FIELD_INVALID' })).toContain(
      'available custom field',
    );
  });
});
