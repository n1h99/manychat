import {
  conditionOperators,
  waitReplyMediaTypes,
  type ConditionOperator,
} from '@omnicus/automation-core';
import {
  Alert,
  AutoComplete,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Tabs,
  Typography,
} from 'antd';
import { useEffect, useState } from 'react';

import { ApiError } from './api';
import type { ScenarioSummary } from './automation-api';
import type {
  AutomationCustomField,
  AutomationSecret,
  AutomationTag,
  ExternalHttpTestResult,
} from './automation-studio-api';
import {
  conditionFieldType,
  defaultCustomFieldValue,
  durationParts,
  durationSeconds,
  durationUnits,
  externalHttpSafeErrorMessage,
  previewAutomationText,
  type DurationUnit,
} from './automation-studio';
import type { MessageTemplate } from './templates-api';

interface Props {
  config: Record<string, unknown>;
  customFields: AutomationCustomField[];
  nodeType: string;
  onCreateSecret(name: string, value: string): Promise<string>;
  onChange(config: Record<string, unknown>): void;
  scenarios: ScenarioSummary[];
  secrets: AutomationSecret[];
  tags: AutomationTag[];
  templates: MessageTemplate[];
  testHttpRequest(
    config: Record<string, unknown>,
    variables?: Record<string, unknown>,
  ): Promise<ExternalHttpTestResult>;
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
  onCreateSecret,
  onChange,
  scenarios,
  secrets,
  tags,
  templates,
  testHttpRequest,
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

  if (nodeType === 'EXTERNAL_HTTP_REQUEST')
    return (
      <ExternalHttpFields
        config={config}
        onChange={onChange}
        onCreateSecret={onCreateSecret}
        secrets={secrets}
        testRequest={testHttpRequest}
      />
    );

  return (
    <div className="automation-node-empty-config">
      <strong>No additional settings</strong>
      <small>This step is ready to use as soon as it is connected.</small>
    </div>
  );
}

function ExternalHttpFields({
  config,
  onChange,
  onCreateSecret,
  secrets,
  testRequest,
}: {
  config: Record<string, unknown>;
  onChange(config: Record<string, unknown>): void;
  onCreateSecret(name: string, value: string): Promise<string>;
  secrets: AutomationSecret[];
  testRequest(
    config: Record<string, unknown>,
    variables?: Record<string, unknown>,
  ): Promise<ExternalHttpTestResult>;
}) {
  const [secretName, setSecretName] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [creatingSecret, setCreatingSecret] = useState(false);
  const [secretError, setSecretError] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string>();
  const [testResult, setTestResult] = useState<ExternalHttpTestResult>();
  const [testVariablesDraft, setTestVariablesDraft] = useState('{}');
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });
  const query = objectArray(config.query);
  const headers = objectArray(config.headers);
  const mappings = objectArray(config.mappings);
  const method = typeof config.method === 'string' ? config.method : 'GET';
  const contentType =
    typeof config.contentType === 'string' ? config.contentType : 'application/json';

  const requestTab = (
    <Space className="automation-http-section" direction="vertical" style={{ width: '100%' }}>
      <Form.Item label="Method">
        <Select
          onChange={(value) => set('method', value)}
          options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({
            label: value,
            value,
          }))}
          value={method}
        />
      </Form.Item>
      <Form.Item label="HTTPS URL">
        <Input
          maxLength={2048}
          onChange={(event) => set('url', event.target.value)}
          placeholder="https://api.example.com/hooks/{{contact.id}}"
          value={typeof config.url === 'string' ? config.url : 'https://'}
        />
      </Form.Item>
      <Space.Compact block>
        <Form.Item label="Timeout, ms" style={{ width: '50%' }}>
          <InputNumber
            max={30_000}
            min={1_000}
            onChange={(value) => set('timeoutMs', value ?? 10_000)}
            precision={0}
            style={{ width: '100%' }}
            value={typeof config.timeoutMs === 'number' ? config.timeoutMs : 10_000}
          />
        </Form.Item>
        <Form.Item label="Maximum attempts" style={{ width: '50%' }}>
          <InputNumber
            max={5}
            min={1}
            onChange={(value) => set('maxAttempts', value ?? 1)}
            precision={0}
            style={{ width: '100%' }}
            value={typeof config.maxAttempts === 'number' ? config.maxAttempts : 1}
          />
        </Form.Item>
      </Space.Compact>
      <Typography.Text strong>Query parameters</Typography.Text>
      {query.map((item, index) => (
        <Space.Compact block key={`query-${index}`}>
          <Input
            onChange={(event) =>
              set('query', replaceAt(query, index, { ...item, name: event.target.value }))
            }
            placeholder="name"
            value={stringValue(item.name)}
          />
          <Input
            onChange={(event) =>
              set('query', replaceAt(query, index, { ...item, value: event.target.value }))
            }
            placeholder="{{contact.id}}"
            value={stringValue(item.value)}
          />
          <Button danger onClick={() => set('query', removeAt(query, index))}>
            Remove
          </Button>
        </Space.Compact>
      ))}
      <Button
        disabled={query.length >= 20}
        onClick={() => set('query', [...query, { name: '', value: '' }])}
      >
        Add query parameter
      </Button>
    </Space>
  );

  const headersTab = (
    <Space className="automation-http-section" direction="vertical" style={{ width: '100%' }}>
      <Alert
        message="Authorization, Cookie and X-Api-Key values must use a write-only project secret."
        showIcon
        type="info"
      />
      {headers.map((item, index) => {
        const usesSecret = typeof item.secretId === 'string';
        return (
          <Space direction="vertical" key={`header-${index}`} style={{ width: '100%' }}>
            <Input
              onChange={(event) =>
                set('headers', replaceAt(headers, index, { ...item, name: event.target.value }))
              }
              placeholder="Header name"
              value={stringValue(item.name)}
            />
            <Select
              onChange={(mode: 'secret' | 'value') =>
                set(
                  'headers',
                  replaceAt(
                    headers,
                    index,
                    mode === 'secret'
                      ? { name: item.name, secretId: secrets[0]?.id }
                      : { name: item.name, value: '' },
                  ),
                )
              }
              options={[
                { label: 'Visible template value', value: 'value' },
                { label: 'Write-only secret reference', value: 'secret' },
              ]}
              value={usesSecret ? 'secret' : 'value'}
            />
            {usesSecret ? (
              <Select
                onChange={(secretId) =>
                  set('headers', replaceAt(headers, index, { name: item.name, secretId }))
                }
                options={secrets.map((secret) => ({ label: secret.name, value: secret.id }))}
                placeholder="Select secret"
                value={item.secretId}
              />
            ) : (
              <Input
                onChange={(event) =>
                  set(
                    'headers',
                    replaceAt(headers, index, { name: item.name, value: event.target.value }),
                  )
                }
                placeholder="Header value or {{variable}}"
                value={stringValue(item.value)}
              />
            )}
            <Button danger onClick={() => set('headers', removeAt(headers, index))} size="small">
              Remove header
            </Button>
          </Space>
        );
      })}
      <Button
        disabled={headers.length >= 20}
        onClick={() => set('headers', [...headers, { name: '', value: '' }])}
      >
        Add header
      </Button>
      <Typography.Text strong>Create write-only secret</Typography.Text>
      <Input
        onChange={(event) => setSecretName(event.target.value)}
        placeholder="Secret name"
        value={secretName}
      />
      <Input.Password
        onChange={(event) => setSecretValue(event.target.value)}
        placeholder="Secret value (never shown again)"
        value={secretValue}
      />
      <Button
        disabled={!secretName.trim() || !secretValue}
        loading={creatingSecret}
        onClick={async () => {
          setCreatingSecret(true);
          try {
            await onCreateSecret(secretName, secretValue);
            setSecretError(false);
            setSecretName('');
            setSecretValue('');
          } catch {
            setSecretError(true);
          } finally {
            setCreatingSecret(false);
          }
        }}
      >
        Save secret
      </Button>
      {secretError ? (
        <Typography.Text type="danger">
          Secret could not be saved. Check the name and try again.
        </Typography.Text>
      ) : null}
    </Space>
  );

  const bodyTab = (
    <Space className="automation-http-section" direction="vertical" style={{ width: '100%' }}>
      <Form.Item label="Content type">
        <Select
          disabled={method === 'GET'}
          onChange={(value) => set('contentType', value)}
          options={['application/json', 'application/x-www-form-urlencoded', 'text/plain'].map(
            (value) => ({ label: value, value }),
          )}
          value={contentType}
        />
      </Form.Item>
      {method === 'GET' ? (
        <Typography.Text type="secondary">GET requests do not send a body.</Typography.Text>
      ) : contentType === 'application/json' ? (
        <JsonValueInput onChange={(value) => set('body', value)} value={config.body ?? {}} />
      ) : (
        <Input.TextArea
          maxLength={65_536}
          onChange={(event) => set('body', event.target.value)}
          rows={8}
          value={typeof config.body === 'string' ? config.body : ''}
        />
      )}
    </Space>
  );

  const responseTab = (
    <Space className="automation-http-section" direction="vertical" style={{ width: '100%' }}>
      <Space.Compact block>
        <Form.Item label="Success from" style={{ width: '50%' }}>
          <InputNumber
            max={599}
            min={100}
            onChange={(value) => set('successStatusMinimum', value ?? 200)}
            value={
              typeof config.successStatusMinimum === 'number' ? config.successStatusMinimum : 200
            }
          />
        </Form.Item>
        <Form.Item label="Success through" style={{ width: '50%' }}>
          <InputNumber
            max={599}
            min={100}
            onChange={(value) => set('successStatusMaximum', value ?? 299)}
            value={
              typeof config.successStatusMaximum === 'number' ? config.successStatusMaximum : 299
            }
          />
        </Form.Item>
      </Space.Compact>
      {mappings.map((item, index) => (
        <Space direction="vertical" key={`mapping-${index}`} style={{ width: '100%' }}>
          <Input
            onChange={(event) =>
              set(
                'mappings',
                replaceAt(mappings, index, { ...item, sourcePath: event.target.value }),
              )
            }
            placeholder="response.data.customerId"
            value={stringValue(item.sourcePath)}
          />
          <Input
            onChange={(event) =>
              set(
                'mappings',
                replaceAt(mappings, index, { ...item, targetPath: event.target.value }),
              )
            }
            placeholder="crm.customerId"
            value={stringValue(item.targetPath)}
          />
          <Select
            onChange={(type) => set('mappings', replaceAt(mappings, index, { ...item, type }))}
            options={['json', 'string', 'number', 'boolean'].map((value) => ({
              label: value,
              value,
            }))}
            value={typeof item.type === 'string' ? item.type : 'json'}
          />
          <Checkbox
            checked={item.required === true}
            onChange={(event) =>
              set(
                'mappings',
                replaceAt(mappings, index, { ...item, required: event.target.checked }),
              )
            }
          >
            Required mapping
          </Checkbox>
          <Button danger onClick={() => set('mappings', removeAt(mappings, index))} size="small">
            Remove mapping
          </Button>
        </Space>
      ))}
      <Button
        disabled={mappings.length >= 20}
        onClick={() =>
          set('mappings', [
            ...mappings,
            {
              required: false,
              sourcePath: 'response.data',
              targetPath: 'http.result',
              type: 'json',
            },
          ])
        }
      >
        Add response mapping
      </Button>
    </Space>
  );

  const testTab = (
    <Space className="automation-http-section" direction="vertical" style={{ width: '100%' }}>
      <Alert
        message="Test performs a real bounded HTTPS request and does not publish the scenario."
        showIcon
        type="warning"
      />
      <Form.Item label="Sample variables JSON">
        <Input.TextArea
          onChange={(event) => setTestVariablesDraft(event.target.value)}
          rows={6}
          value={testVariablesDraft}
        />
      </Form.Item>
      <Button
        loading={testing}
        onClick={async () => {
          setTesting(true);
          try {
            const parsed = JSON.parse(testVariablesDraft) as unknown;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
            setTestResult(await testRequest(config, parsed as Record<string, unknown>));
            setTestError(undefined);
          } catch (error) {
            setTestResult(undefined);
            setTestError(error instanceof ApiError ? error.code : 'REQUEST_FAILED');
          } finally {
            setTesting(false);
          }
        }}
        type="primary"
      >
        Test request
      </Button>
      {testError ? (
        <div className="automation-http-test-error" role="alert">
          <strong>Request blocked safely</strong>
          <span>{externalHttpSafeErrorMessage(testError)}</span>
          <code>{testError}</code>
        </div>
      ) : null}
      {testResult ? (
        <Alert
          description={
            <pre className="automation-http-preview">
              {JSON.stringify(
                {
                  data: testResult.data,
                  mappingKeys: testResult.mappingKeys,
                  outcome: testResult.outcome,
                  previewTruncated: testResult.previewTruncated,
                  sizeBytes: testResult.sizeBytes,
                  statusCode: testResult.statusCode,
                },
                null,
                2,
              )}
            </pre>
          }
          message="Safe response preview"
          type={testResult.outcome === 'success' ? 'success' : 'warning'}
        />
      ) : null}
    </Space>
  );

  return (
    <Tabs
      className="automation-http-tabs"
      items={[
        { children: requestTab, key: 'request', label: 'Request' },
        { children: headersTab, key: 'headers', label: 'Headers' },
        { children: bodyTab, key: 'body', label: 'Body' },
        { children: responseTab, key: 'response', label: 'Response' },
        { children: testTab, key: 'test', label: 'Test' },
      ]}
      size="small"
    />
  );
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
        <AutoComplete
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
          placeholder="Choose a field or enter crm.leadId"
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
      label: 'Execution variables',
      options: [
        {
          label: 'Mapped HTTP value (replace path)',
          value: 'crm.leadId',
        },
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

function objectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(record) : [];
}

function replaceAt(
  values: Array<Record<string, unknown>>,
  index: number,
  value: Record<string, unknown>,
): Array<Record<string, unknown>> {
  return values.map((candidate, candidateIndex) => (candidateIndex === index ? value : candidate));
}

function removeAt(
  values: Array<Record<string, unknown>>,
  index: number,
): Array<Record<string, unknown>> {
  return values.filter((_, candidateIndex) => candidateIndex !== index);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
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
