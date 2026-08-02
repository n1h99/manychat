import { describe, expect, it } from 'vitest';

import {
  automationNodeLabel,
  conditionFieldType,
  durationParts,
  durationSeconds,
  externalHttpSafeErrorMessage,
  humanizeAutomationValidationIssue,
  previewAutomationText,
  safeDiagnosticJson,
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
});
