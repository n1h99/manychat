import type { AutomationCustomField } from './automation-studio-api';

export const durationUnits = {
  days: 86_400,
  hours: 3_600,
  minutes: 60,
  seconds: 1,
} as const;

export type DurationUnit = keyof typeof durationUnits;

export function durationParts(secondsInput: unknown): { unit: DurationUnit; value: number } {
  const seconds =
    typeof secondsInput === 'number' && Number.isInteger(secondsInput) && secondsInput > 0
      ? secondsInput
      : 60;
  for (const unit of ['days', 'hours', 'minutes'] as const) {
    const multiplier = durationUnits[unit];
    if (seconds % multiplier === 0) return { unit, value: seconds / multiplier };
  }
  return { unit: 'seconds', value: seconds };
}

export function durationSeconds(value: number | null, unit: DurationUnit): number {
  return Math.max(1, Math.round((value ?? 1) * durationUnits[unit]));
}

export function defaultCustomFieldValue(field?: AutomationCustomField): unknown {
  if (!field) return '';
  if (field.type === 'NUMBER') return 0;
  if (field.type === 'BOOLEAN') return false;
  if (field.type === 'MULTI_SELECT') return [];
  if (field.type === 'JSON') return {};
  return '';
}

export function conditionFieldType(
  fieldPath: string | undefined,
  customFields: AutomationCustomField[],
): AutomationCustomField['type'] | 'TEXT' {
  if (!fieldPath?.startsWith('contact.customFields.')) return 'TEXT';
  const key = fieldPath.slice('contact.customFields.'.length);
  return customFields.find((field) => field.key === key)?.type ?? 'TEXT';
}

export function safeDiagnosticJson(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0) return undefined;
  return JSON.stringify(value, null, 2);
}

export function automationEditorSignature(
  graph: unknown,
  name: string | undefined,
  description: string | undefined,
): string {
  return JSON.stringify({ description: description ?? '', graph, name: name ?? '' });
}

const automationNodeLabels: Record<string, string> = {
  ADD_TAG: 'Add tag',
  CONDITION: 'Condition',
  CREATE_OR_UPDATE_LEAD: 'Create or update lead',
  DELAY: 'Delay',
  EXTERNAL_HTTP_REQUEST: 'External HTTP request',
  FORWARD_TO_CRM: 'Forward to CRM',
  INCOMING_MESSAGE: 'Incoming message',
  PAUSE_AUTOMATION: 'Pause automation',
  REMOVE_TAG: 'Remove tag',
  RESUME_AUTOMATION: 'Resume automation',
  SEND_MESSAGE: 'Send message',
  SEND_TEMPLATE: 'Send template',
  SET_CUSTOM_FIELD: 'Set custom field',
  START_SUBFLOW: 'Subflow',
  STOP: 'Stop',
  WAIT_FOR_REPLY: 'Wait for reply',
};

export function automationNodeLabel(nodeType: string): string {
  return automationNodeLabels[nodeType] ?? nodeType.toLowerCase().replaceAll('_', ' ');
}

export function automationNodeDescription(nodeType: string): string {
  const descriptions: Record<string, string> = {
    ADD_TAG: 'Add a project tag to the contact.',
    CONDITION: 'Route the contact through matching and fallback branches.',
    CREATE_OR_UPDATE_LEAD: 'Create or refresh the paired CRM lead.',
    DELAY: 'Continue after a durable delay.',
    EXTERNAL_HTTP_REQUEST: 'Call an approved public HTTPS endpoint through the safe outbox.',
    FORWARD_TO_CRM: 'Forward the current inbound event to the paired CRM.',
    INCOMING_MESSAGE: 'Start this scenario for a supported inbound event.',
    PAUSE_AUTOMATION: 'Pause automation for this contact.',
    REMOVE_TAG: 'Remove a project tag from the contact.',
    RESUME_AUTOMATION: 'Resume automation for this contact.',
    SEND_MESSAGE: 'Queue a Telegram message with optional contact variables.',
    SEND_TEMPLATE: 'Queue one immutable published template version.',
    SET_CUSTOM_FIELD: 'Set a typed custom-field value on the contact.',
    START_SUBFLOW: 'Run a pinned published version of another scenario.',
    STOP: 'Finish this path without another action.',
    WAIT_FOR_REPLY: 'Wait for a matching customer reply or continue on timeout.',
  };
  return descriptions[nodeType] ?? 'Configure this automation step.';
}

export function humanizeAutomationValidationIssue(
  issue: string,
  nodes: Array<{ id: string; type: string }>,
): { message: string; nodeId?: string } {
  const node = nodes.find((candidate) => issue.includes(candidate.id));
  if (issue === 'Incoming Message trigger must have an outgoing path')
    return {
      message: 'Incoming message needs an outgoing connection.',
      ...(nodes.find((candidate) => candidate.type === 'INCOMING_MESSAGE')?.id
        ? { nodeId: nodes.find((candidate) => candidate.type === 'INCOMING_MESSAGE')!.id }
        : {}),
    };
  if (node && issue === `Node ${node.id} is unreachable`)
    return {
      message: `${automationNodeLabel(node.type)} is not connected to the trigger.`,
      nodeId: node.id,
    };
  let message = issue;
  if (node) message = message.replaceAll(node.id, automationNodeLabel(node.type));
  message = message
    .replaceAll('Incoming Message', 'Incoming message')
    .replaceAll('Wait for Reply', 'Wait for reply')
    .replaceAll('delaySeconds', 'delay')
    .replaceAll('timeoutSeconds', 'timeout');
  return {
    message: message.endsWith('.') ? message : `${message}.`,
    ...(node ? { nodeId: node.id } : {}),
  };
}

export function externalHttpSafeErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    external_http_config_invalid: 'Complete the required request settings before testing.',
    external_http_dns_unavailable: 'The destination could not be resolved. Try again later.',
    external_http_target_forbidden:
      'The destination resolved only to private or restricted network addresses.',
    external_http_url_forbidden: 'Use a public HTTPS URL without embedded credentials.',
    external_http_url_invalid: 'Enter a valid public HTTPS URL.',
  };
  return messages[code] ?? 'The request failed safely. Review the request settings and try again.';
}

export function previewAutomationText(
  source: string,
  customFields: AutomationCustomField[],
): { missing: string[]; output: string } {
  const customFieldSamples = Object.fromEntries(
    customFields.map((field) => [field.key, sampleValue(field.type)]),
  );
  const context: Record<string, unknown> = {
    contact: {
      customFields: customFieldSamples,
      displayName: 'Alex Example',
      email: 'alex@example.test',
      firstName: 'Alex',
      lastName: 'Example',
      phone: '+10000000000',
      username: 'alex_example',
    },
    event: { content: { data: 'confirm', text: 'Example reply' }, type: 'MESSAGE' },
  };
  const missing = new Set<string>();
  const output = source.replace(/{{\s*([a-zA-Z0-9_.]+)\s*}}/g, (_, path: string) => {
    const value = path.split('.').reduce<unknown>((current, part) => {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
      return (current as Record<string, unknown>)[part];
    }, context);
    if (value === undefined || value === null || typeof value === 'object') {
      missing.add(path);
      return '';
    }
    return String(value);
  });
  return { missing: [...missing], output };
}

function sampleValue(type: AutomationCustomField['type']): unknown {
  if (type === 'NUMBER') return 42;
  if (type === 'BOOLEAN') return true;
  if (type === 'MULTI_SELECT') return ['sample'];
  if (type === 'JSON') return { sample: true };
  return 'Sample value';
}
