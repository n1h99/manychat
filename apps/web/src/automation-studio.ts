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
