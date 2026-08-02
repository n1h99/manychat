import {
  conditionOperators,
  waitReplyMediaTypes,
  type ConditionOperator,
} from '@omnicus/automation-core';
import { Button, Checkbox, Form, Input, InputNumber, Select, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';

import type { ScenarioSummary } from './automation-api';
import type { AutomationCustomField, AutomationTag } from './automation-studio-api';
import {
  conditionFieldType,
  defaultCustomFieldValue,
  durationParts,
  durationSeconds,
  durationUnits,
  previewAutomationText,
  type DurationUnit,
} from './automation-studio';
import type { MessageTemplate } from './templates-api';

interface Props {
  config: Record<string, unknown>;
  customFields: AutomationCustomField[];
  nodeType: string;
  onChange(config: Record<string, unknown>): void;
  scenarios: ScenarioSummary[];
  tags: AutomationTag[];
  templates: MessageTemplate[];
}

interface ConditionProps {
  condition: { field?: string; operator?: string; value?: unknown };
  customFields: AutomationCustomField[];
  onChange(condition: { field: string; operator: ConditionOperator; value?: unknown }): void;
}

interface ConditionGroupProps {
  customFields: AutomationCustomField[];
  group: {
    combinator: 'AND' | 'OR';
    rules: Array<{ field: string; operator: string; value?: unknown }>;
  };
  onChange(group: {
    combinator: 'AND' | 'OR';
    rules: Array<{ field: string; operator: string; value?: unknown }>;
  }): void;
}

const conditionOperatorLabels: Record<ConditionOperator, string> = {
  contains: 'Contains',
  ends_with: 'Ends with',
  equals: 'Equals',
  exists: 'Exists',
  greater_or_equal: 'Greater than or equal',
  greater_than: 'Greater than',
  less_or_equal: 'Less than or equal',
  less_than: 'Less than',
  not_equals: 'Does not equal',
  not_exists: 'Does not exist',
  starts_with: 'Starts with',
};

const mediaTypeLabels: Record<(typeof waitReplyMediaTypes)[number], string> = {
  ANIMATION: 'Animation',
  AUDIO: 'Audio',
  DOCUMENT: 'Document',
  PHOTO: 'Photo',
  STICKER: 'Sticker',
  VIDEO: 'Video',
  VIDEO_NOTE: 'Video note',
  VOICE: 'Voice message',
};

export function AutomationNodeConfig({
  config,
  customFields,
  nodeType,
  onChange,
  scenarios,
  tags,
  templates,
}: Props) {
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });

  if (nodeType === 'SEND_MESSAGE') {
    const text = typeof config.text === 'string' ? config.text : '';
    const preview = previewAutomationText(text, customFields);
    return (
      <Space direction="vertical" style={{ width: '100%' }}>
        <Form.Item label="Message text">
          <Input.TextArea
            maxLength={4096}
            onChange={(event) => set('text', event.target.value)}
            rows={6}
            value={text}
          />
        </Form.Item>
        <Form.Item label="Insert variable">
          <Select
            onChange={(path: string) => set('text', `${text}{{${path}}}`)}
            options={automationVariableOptions(customFields)}
            placeholder="Choose a contact or event variable"
            showSearch
            value={null}
          />
        </Form.Item>
        <div className="automation-message-preview">
          <Typography.Text strong>Preview</Typography.Text>
          <Typography.Paragraph>
            {preview.output || 'Message preview is empty.'}
          </Typography.Paragraph>
          {preview.missing.length ? (
            <Typography.Text type="danger">
              Missing sample values: {preview.missing.join(', ')}
            </Typography.Text>
          ) : null}
        </div>
      </Space>
    );
  }

  if (nodeType === 'SEND_TEMPLATE')
    return (
      <Form.Item label="Published template version">
        <Select
          onChange={(versionId: string) => {
            const template = templates.find(
              (candidate) => candidate.activeVersion?.id === versionId,
            );
            onChange({ templateId: template?.id, templateVersionId: versionId });
          }}
          options={templates
            .filter((template) => template.status === 'PUBLISHED' && template.activeVersion)
            .map((template) => ({
              label: `${template.name} (${template.activeVersion!.kind})`,
              value: template.activeVersion!.id,
            }))}
          placeholder="Select a published template"
          showSearch
          value={typeof config.templateVersionId === 'string' ? config.templateVersionId : null}
        />
      </Form.Item>
    );

  if (nodeType === 'CONDITION')
    return (
      <>
        <Typography.Paragraph type="secondary">
          Configure each branch on its connection. This fallback is used only when a branch has no
          condition of its own.
        </Typography.Paragraph>
        <AutomationConditionFields
          condition={config}
          customFields={customFields}
          onChange={(condition) => onChange(condition)}
        />
      </>
    );

  if (nodeType === 'DELAY' || nodeType === 'WAIT_FOR_REPLY') {
    const key = nodeType === 'DELAY' ? 'delaySeconds' : 'timeoutSeconds';
    return (
      <Space direction="vertical" style={{ width: '100%' }}>
        <DurationField
          label={nodeType === 'DELAY' ? 'Delay for' : 'Wait up to'}
          onChange={(seconds) => set(key, seconds)}
          seconds={config[key]}
        />
        {nodeType === 'WAIT_FOR_REPLY' ? (
          <WaitCriteriaFields
            criteria={record(config.criteria)}
            onChange={(criteria) => set('criteria', criteria)}
          />
        ) : null}
      </Space>
    );
  }

  if (nodeType === 'ADD_TAG' || nodeType === 'REMOVE_TAG')
    return (
      <Form.Item label="Tag">
        <Select
          onChange={(tagId) => set('tagId', tagId)}
          options={tags.map((tag) => ({ label: tag.name, value: tag.id }))}
          placeholder="Select a project tag"
          showSearch
          value={typeof config.tagId === 'string' ? config.tagId : null}
        />
      </Form.Item>
    );

  if (nodeType === 'SET_CUSTOM_FIELD') {
    const selected = customFields.find((field) => field.key === config.key);
    return (
      <Space direction="vertical" style={{ width: '100%' }}>
        <Form.Item label="Custom field">
          <Select
            onChange={(key: string) => {
              const field = customFields.find((candidate) => candidate.key === key);
              onChange({ key, value: defaultCustomFieldValue(field) });
            }}
            options={customFields.map((field) => ({
              label: `${field.name} (${field.type.toLowerCase()})`,
              value: field.key,
            }))}
            placeholder="Select an active custom field"
            showSearch
            value={typeof config.key === 'string' ? config.key : null}
          />
        </Form.Item>
        {selected ? (
          <Form.Item label="Value">
            <CustomFieldValueInput
              field={selected}
              onChange={(value) => set('value', value)}
              value={config.value}
            />
          </Form.Item>
        ) : null}
      </Space>
    );
  }

  if (nodeType === 'START_SUBFLOW')
    return (
      <Form.Item label="Published scenario">
        <Select
          onChange={(value: string) => {
            const scenario = scenarios.find((candidate) => candidate.id === value);
            onChange({ scenarioId: value, scenarioVersionId: scenario?.activeVersionId });
          }}
          options={scenarios
            .filter((scenario) => scenario.status === 'PUBLISHED' && scenario.activeVersionId)
            .map((scenario) => ({ label: scenario.name, value: scenario.id }))}
          placeholder="Select a published scenario"
          showSearch
          value={typeof config.scenarioId === 'string' ? config.scenarioId : null}
        />
      </Form.Item>
    );

  return <Typography.Text type="secondary">This node has no configurable fields.</Typography.Text>;
}

export function AutomationConditionFields({ condition, customFields, onChange }: ConditionProps) {
  const field = condition.field ?? 'message.text';
  const operator = conditionOperators.includes(condition.operator as ConditionOperator)
    ? (condition.operator as ConditionOperator)
    : 'exists';
  const fieldType = conditionFieldType(field, customFields);
  const operators = operatorsFor(fieldType);
  const selectedField = customFields.find(
    (candidate) => `contact.customFields.${candidate.key}` === field,
  );
  const update = (
    next: Partial<{ field: string; operator: ConditionOperator; value: unknown }>,
  ) => {
    const nextOperator = next.operator ?? operator;
    const nextField = next.field ?? field;
    const nextFieldType = conditionFieldType(nextField, customFields);
    const nextDefinition = customFields.find(
      (candidate) => `contact.customFields.${candidate.key}` === nextField,
    );
    const nextValue =
      next.value === undefined
        ? (condition.value ?? defaultComparisonValue(nextFieldType, nextDefinition))
        : next.value;
    onChange({
      field: nextField,
      operator: nextOperator,
      ...(['exists', 'not_exists'].includes(nextOperator) ? {} : { value: nextValue ?? '' }),
    });
  };
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Form.Item label="Field">
        <Select
          onChange={(value: string) => {
            const type = conditionFieldType(value, customFields);
            const nextOperator = operatorsFor(type).includes(operator) ? operator : 'equals';
            const definition = customFields.find(
              (candidate) => `contact.customFields.${candidate.key}` === value,
            );
            onChange({
              field: value,
              operator: nextOperator,
              ...(['exists', 'not_exists'].includes(nextOperator)
                ? {}
                : { value: defaultComparisonValue(type, definition) }),
            });
          }}
          options={conditionFieldOptions(customFields)}
          showSearch
          value={field}
        />
      </Form.Item>
      <Form.Item label="Operator">
        <Select
          onChange={(value: ConditionOperator) => update({ operator: value })}
          options={operators.map((value) => ({ label: conditionOperatorLabels[value], value }))}
          value={operator}
        />
      </Form.Item>
      {!['exists', 'not_exists'].includes(operator) ? (
        <Form.Item label="Comparison value">
          <ConditionValueInput
            field={selectedField}
            fieldType={fieldType}
            onChange={(value) => update({ value })}
            value={condition.value}
          />
        </Form.Item>
      ) : null}
    </Space>
  );
}

export function AutomationConditionGroupFields({
  customFields,
  group,
  onChange,
}: ConditionGroupProps) {
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Form.Item label="Match rules">
        <Select
          onChange={(combinator: 'AND' | 'OR') => onChange({ ...group, combinator })}
          options={[
            { label: 'All rules (AND)', value: 'AND' },
            { label: 'Any rule (OR)', value: 'OR' },
          ]}
          value={group.combinator}
        />
      </Form.Item>
      {group.rules.map((rule, index) => (
        <div className="automation-condition-rule" key={`${index}-${rule.field}`}>
          <Typography.Text strong>Rule {index + 1}</Typography.Text>
          <AutomationConditionFields
            condition={rule}
            customFields={customFields}
            onChange={(next) =>
              onChange({
                ...group,
                rules: group.rules.map((candidate, candidateIndex) =>
                  candidateIndex === index ? next : candidate,
                ),
              })
            }
          />
          {group.rules.length > 1 ? (
            <Button
              danger
              onClick={() =>
                onChange({
                  ...group,
                  rules: group.rules.filter((_, candidateIndex) => candidateIndex !== index),
                })
              }
              size="small"
            >
              Remove rule
            </Button>
          ) : null}
        </div>
      ))}
      <Button
        disabled={group.rules.length >= 20}
        onClick={() =>
          onChange({
            ...group,
            rules: [...group.rules, { field: 'message.text', operator: 'exists' }],
          })
        }
      >
        Add rule
      </Button>
    </Space>
  );
}

function DurationField({
  label,
  onChange,
  seconds,
}: {
  label: string;
  onChange(seconds: number): void;
  seconds: unknown;
}) {
  const parts = durationParts(seconds);
  return (
    <Form.Item label={label}>
      <Space.Compact block>
        <InputNumber
          min={1}
          onChange={(value) => onChange(durationSeconds(value, parts.unit))}
          precision={0}
          style={{ width: '55%' }}
          value={parts.value}
        />
        <Select
          onChange={(unit: DurationUnit) => onChange(durationSeconds(parts.value, unit))}
          options={Object.keys(durationUnits).map((unit) => ({ label: unit, value: unit }))}
          style={{ width: '45%' }}
          value={parts.unit}
        />
      </Space.Compact>
    </Form.Item>
  );
}

function WaitCriteriaFields({
  criteria,
  onChange,
}: {
  criteria: Record<string, unknown>;
  onChange(criteria: Record<string, unknown>): void;
}) {
  const kind = typeof criteria.kind === 'string' ? criteria.kind : 'ANY';
  const setKind = (next: string) => {
    if (next === 'ANY') onChange({ kind: 'ANY' });
    else if (next === 'MEDIA') onChange({ kind: 'MEDIA', mediaTypes: ['PHOTO'] });
    else
      onChange({
        caseSensitive: next === 'CALLBACK',
        kind: next,
        operator: 'equals',
        value: '',
      });
  };
  return (
    <>
      <Form.Item label="Reply type">
        <Select
          onChange={setKind}
          options={[
            { label: 'Any supported customer reply', value: 'ANY' },
            { label: 'Text message', value: 'TEXT' },
            { label: 'Button callback', value: 'CALLBACK' },
            { label: 'Selected media types', value: 'MEDIA' },
          ]}
          value={kind}
        />
      </Form.Item>
      {kind === 'TEXT' || kind === 'CALLBACK' ? (
        <>
          <Form.Item label={kind === 'TEXT' ? 'Text comparison' : 'Callback comparison'}>
            <Select
              onChange={(operator) => onChange({ ...criteria, operator })}
              options={['equals', 'contains', 'starts_with', 'ends_with'].map((value) => ({
                label: conditionOperatorLabels[value as ConditionOperator],
                value,
              }))}
              value={typeof criteria.operator === 'string' ? criteria.operator : 'equals'}
            />
          </Form.Item>
          <Form.Item label={kind === 'TEXT' ? 'Expected text' : 'Expected callback data'}>
            <Input
              maxLength={kind === 'TEXT' ? 4096 : 64}
              onChange={(event) => onChange({ ...criteria, value: event.target.value })}
              value={typeof criteria.value === 'string' ? criteria.value : ''}
            />
          </Form.Item>
          <Checkbox
            checked={criteria.caseSensitive === true}
            onChange={(event) => onChange({ ...criteria, caseSensitive: event.target.checked })}
          >
            Case-sensitive comparison
          </Checkbox>
        </>
      ) : null}
      {kind === 'MEDIA' ? (
        <Form.Item label="Accepted media">
          <Select
            mode="multiple"
            onChange={(mediaTypes) => onChange({ kind: 'MEDIA', mediaTypes })}
            options={waitReplyMediaTypes.map((value) => ({
              label: mediaTypeLabels[value],
              value,
            }))}
            value={Array.isArray(criteria.mediaTypes) ? criteria.mediaTypes : []}
          />
        </Form.Item>
      ) : null}
    </>
  );
}

function ConditionValueInput({
  field,
  fieldType,
  onChange,
  value,
}: {
  field: AutomationCustomField | undefined;
  fieldType: AutomationCustomField['type'] | 'TEXT';
  onChange(value: unknown): void;
  value: unknown;
}) {
  if (fieldType === 'NUMBER')
    return <InputNumber onChange={onChange} style={{ width: '100%' }} value={numberValue(value)} />;
  if (fieldType === 'BOOLEAN')
    return (
      <Select
        onChange={onChange}
        options={[
          { label: 'True', value: true },
          { label: 'False', value: false },
        ]}
        value={typeof value === 'boolean' ? value : false}
      />
    );
  if (field && ['SELECT', 'MULTI_SELECT'].includes(fieldType))
    return (
      <Select
        onChange={onChange}
        options={(field.options ?? []).map((option) => ({ label: option, value: option }))}
        showSearch
        value={typeof value === 'string' ? value : undefined}
      />
    );
  return (
    <Input
      onChange={(event) => onChange(event.target.value)}
      type={fieldType === 'DATE' ? 'date' : fieldType === 'DATETIME' ? 'datetime-local' : 'text'}
      value={typeof value === 'string' ? value : ''}
    />
  );
}

function CustomFieldValueInput({
  field,
  onChange,
  value,
}: {
  field: AutomationCustomField;
  onChange(value: unknown): void;
  value: unknown;
}) {
  if (field.type === 'JSON') return <JsonValueInput onChange={onChange} value={value} />;
  if (field.type === 'MULTI_SELECT')
    return (
      <Select
        mode="multiple"
        onChange={onChange}
        options={(field.options ?? []).map((option) => ({ label: option, value: option }))}
        value={Array.isArray(value) ? value : []}
      />
    );
  return (
    <ConditionValueInput field={field} fieldType={field.type} onChange={onChange} value={value} />
  );
}

function JsonValueInput({ value, onChange }: { value: unknown; onChange(value: unknown): void }) {
  const serialized = JSON.stringify(value ?? {}, null, 2);
  const [draft, setDraft] = useState(serialized);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setDraft(serialized), [serialized]);
  return (
    <>
      <Input.TextArea
        {...(invalid ? { status: 'error' as const } : {})}
        onBlur={() => {
          try {
            onChange(JSON.parse(draft) as unknown);
            setInvalid(false);
          } catch {
            setInvalid(true);
          }
        }}
        onChange={(event) => setDraft(event.target.value)}
        rows={5}
        value={draft}
      />
      {invalid ? <Typography.Text type="danger">Enter valid JSON.</Typography.Text> : null}
    </>
  );
}

function conditionFieldOptions(customFields: AutomationCustomField[]) {
  return [
    {
      label: 'Incoming event',
      options: [
        { label: 'Message text', value: 'message.text' },
        { label: 'Callback data', value: 'callback.data' },
        { label: 'Event type', value: 'event.type' },
      ],
    },
    {
      label: 'Contact',
      options: [
        { label: 'Display name', value: 'contact.displayName' },
        { label: 'First name', value: 'contact.firstName' },
        { label: 'Last name', value: 'contact.lastName' },
        { label: 'Username', value: 'contact.username' },
        { label: 'Email', value: 'contact.email' },
        { label: 'Phone', value: 'contact.phone' },
      ],
    },
    {
      label: 'Custom fields',
      options: customFields.map((field) => ({
        label: `${field.name} (${field.type.toLowerCase()})`,
        value: `contact.customFields.${field.key}`,
      })),
    },
  ];
}

function automationVariableOptions(customFields: AutomationCustomField[]) {
  return [
    {
      label: 'Contact',
      options: ['displayName', 'firstName', 'lastName', 'username', 'email', 'phone'].map(
        (field) => ({ label: field, value: `contact.${field}` }),
      ),
    },
    {
      label: 'Contact custom fields',
      options: customFields
        .filter((field) => field.type !== 'JSON' && field.type !== 'MULTI_SELECT')
        .map((field) => ({
          label: field.name,
          value: `contact.customFields.${field.key}`,
        })),
    },
    {
      label: 'Incoming event',
      options: [
        { label: 'Event type', value: 'event.type' },
        { label: 'Message text', value: 'event.content.text' },
        { label: 'Callback data', value: 'event.content.data' },
      ],
    },
  ];
}

function operatorsFor(type: AutomationCustomField['type'] | 'TEXT'): ConditionOperator[] {
  if (type === 'NUMBER')
    return [
      'equals',
      'not_equals',
      'greater_than',
      'greater_or_equal',
      'less_than',
      'less_or_equal',
      'exists',
      'not_exists',
    ];
  if (type === 'BOOLEAN') return ['equals', 'not_equals', 'exists', 'not_exists'];
  if (type === 'MULTI_SELECT') return ['contains', 'exists', 'not_exists'];
  if (type === 'JSON') return ['exists', 'not_exists'];
  return ['equals', 'not_equals', 'contains', 'starts_with', 'ends_with', 'exists', 'not_exists'];
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function defaultComparisonValue(
  type: AutomationCustomField['type'] | 'TEXT',
  field: AutomationCustomField | undefined,
): unknown {
  if (type === 'NUMBER') return 0;
  if (type === 'BOOLEAN') return false;
  if (type === 'SELECT' || type === 'MULTI_SELECT') return field?.options?.[0] ?? '';
  return '';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
