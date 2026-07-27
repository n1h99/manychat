import { Form, Input, InputNumber, Select, Space, Typography } from 'antd';
import type { ReactNode } from 'react';

import type { ScenarioSummary } from './automation-api';
import type { MessageTemplate } from './templates-api';

interface Props {
  config: Record<string, unknown>;
  nodeType: string;
  onChange(config: Record<string, unknown>): void;
  scenarios: ScenarioSummary[];
  templates: MessageTemplate[];
}

export function AutomationNodeConfig({ config, nodeType, onChange, scenarios, templates }: Props) {
  const field = (key: string, value: unknown, label: string, control: ReactNode) => (
    <Form.Item label={label}>
      {control}
      {value === undefined ? null : <Typography.Text type="secondary" />}
    </Form.Item>
  );
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });

  if (nodeType === 'SEND_MESSAGE')
    return field(
      'text',
      config.text,
      'Message text',
      <Input.TextArea
        maxLength={4096}
        onChange={(event) => set('text', event.target.value)}
        rows={6}
        value={typeof config.text === 'string' ? config.text : ''}
      />,
    );

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
          value={typeof config.templateVersionId === 'string' ? config.templateVersionId : null}
        />
      </Form.Item>
    );

  if (nodeType === 'CONDITION')
    return (
      <Space direction="vertical" style={{ width: '100%' }}>
        <Form.Item label="Default field">
          <Input
            onChange={(event) => set('field', event.target.value)}
            placeholder="message.text"
            value={typeof config.field === 'string' ? config.field : ''}
          />
        </Form.Item>
        <Form.Item label="Default operator">
          <Select
            onChange={(value) => set('operator', value)}
            options={[
              'equals',
              'not_equals',
              'contains',
              'starts_with',
              'ends_with',
              'exists',
              'not_exists',
            ].map((value) => ({ label: value, value }))}
            value={typeof config.operator === 'string' ? config.operator : 'exists'}
          />
        </Form.Item>
        <Form.Item label="Default comparison value">
          <Input
            onChange={(event) => set('value', event.target.value)}
            value={typeof config.value === 'string' ? config.value : ''}
          />
        </Form.Item>
      </Space>
    );

  if (nodeType === 'DELAY' || nodeType === 'WAIT_FOR_REPLY') {
    const key = nodeType === 'DELAY' ? 'delaySeconds' : 'timeoutSeconds';
    return (
      <Form.Item label={nodeType === 'DELAY' ? 'Delay seconds' : 'Timeout seconds'}>
        <InputNumber
          min={1}
          onChange={(value) => set(key, value ?? 1)}
          value={typeof config[key] === 'number' ? config[key] : 60}
        />
      </Form.Item>
    );
  }

  if (nodeType === 'ADD_TAG' || nodeType === 'REMOVE_TAG')
    return (
      <Form.Item label="Tag ID">
        <Input
          onChange={(event) => set('tagId', event.target.value)}
          value={typeof config.tagId === 'string' ? config.tagId : ''}
        />
      </Form.Item>
    );

  if (nodeType === 'SET_CUSTOM_FIELD')
    return (
      <Space direction="vertical" style={{ width: '100%' }}>
        <Form.Item label="Custom field key">
          <Input
            onChange={(event) => set('key', event.target.value)}
            value={typeof config.key === 'string' ? config.key : ''}
          />
        </Form.Item>
        <Form.Item label="Value">
          <Input
            onChange={(event) => set('value', event.target.value)}
            value={typeof config.value === 'string' ? config.value : ''}
          />
        </Form.Item>
      </Space>
    );

  if (nodeType === 'START_SUBFLOW')
    return (
      <Form.Item label="Published scenario">
        <Select
          onChange={(value: string) => {
            const scenario = scenarios.find((candidate) => candidate.id === value);
            onChange({
              scenarioId: value,
              scenarioVersionId: scenario?.activeVersionId,
            });
          }}
          options={scenarios
            .filter((scenario) => scenario.status === 'PUBLISHED' && scenario.activeVersionId)
            .map((scenario) => ({ label: scenario.name, value: scenario.id }))}
          value={typeof config.scenarioId === 'string' ? config.scenarioId : null}
        />
      </Form.Item>
    );

  return <Typography.Text type="secondary">This node has no configurable fields.</Typography.Text>;
}
