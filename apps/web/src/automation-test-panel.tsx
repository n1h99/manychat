import { Alert, Button, Form, Input, Select, Space, Timeline, Typography } from 'antd';
import { useState } from 'react';

import type { AutomationSimulationResult } from './automation-api';

export interface AutomationTestInput {
  contact?: Record<string, unknown>;
  customFields?: Record<string, unknown>;
  event?: Record<string, unknown>;
  httpOutcome?: 'success' | 'failure';
  waitOutcome?: 'reply' | 'timeout';
}

export function AutomationTestPanel({
  loading,
  nodeLabels,
  nodeTypes,
  onRun,
  result,
  validationErrors,
}: {
  loading: boolean;
  nodeLabels: Record<string, string>;
  nodeTypes: string[];
  onRun(input: AutomationTestInput): Promise<void>;
  result?: AutomationSimulationResult;
  validationErrors: string[];
}) {
  const [customFieldsDraft, setCustomFieldsDraft] = useState('{}');
  const [customFieldsError, setCustomFieldsError] = useState(false);
  const [eventType, setEventType] = useState('MESSAGE');
  const [text, setText] = useState('yes');
  const [callbackData, setCallbackData] = useState('confirm');
  const [firstName, setFirstName] = useState('Test customer');
  const [httpOutcome, setHttpOutcome] = useState<'success' | 'failure'>('success');
  const [waitOutcome, setWaitOutcome] = useState<'reply' | 'timeout'>('reply');
  const includesWait = nodeTypes.includes('WAIT_FOR_REPLY');
  const includesHttp = nodeTypes.includes('EXTERNAL_HTTP_REQUEST');

  const run = async () => {
    let customFields: Record<string, unknown>;
    try {
      const parsed = JSON.parse(customFieldsDraft) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      customFields = parsed as Record<string, unknown>;
      setCustomFieldsError(false);
    } catch {
      setCustomFieldsError(true);
      return;
    }
    const content =
      eventType === 'CALLBACK_QUERY'
        ? { data: callbackData }
        : eventType === 'MESSAGE' || eventType === 'COMMAND'
          ? { text }
          : {};
    await onRun({
      contact: { firstName },
      customFields,
      event: { content, type: eventType },
      httpOutcome,
      waitOutcome,
    });
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Alert
        message="Simulation only — Telegram, CRM, tags and contact data will not be changed."
        showIcon
        type="info"
      />
      <Form layout="vertical">
        <Form.Item label="Event type">
          <Select
            onChange={setEventType}
            options={[
              'MESSAGE',
              'COMMAND',
              'CALLBACK_QUERY',
              'PHOTO',
              'DOCUMENT',
              'VIDEO',
              'AUDIO',
              'VOICE',
              'VIDEO_NOTE',
              'ANIMATION',
              'STICKER',
            ].map((value) => ({ label: value, value }))}
            value={eventType}
          />
        </Form.Item>
        {eventType === 'MESSAGE' || eventType === 'COMMAND' ? (
          <Form.Item label="Incoming text">
            <Input.TextArea onChange={(event) => setText(event.target.value)} value={text} />
          </Form.Item>
        ) : null}
        {eventType === 'CALLBACK_QUERY' ? (
          <Form.Item label="Callback data">
            <Input onChange={(event) => setCallbackData(event.target.value)} value={callbackData} />
          </Form.Item>
        ) : null}
        <Form.Item label="Contact first name">
          <Input onChange={(event) => setFirstName(event.target.value)} value={firstName} />
        </Form.Item>
        <Form.Item
          {...(customFieldsError
            ? { help: 'Enter a JSON object.', validateStatus: 'error' as const }
            : {})}
          label="Custom fields JSON"
        >
          <Input.TextArea
            onChange={(event) => setCustomFieldsDraft(event.target.value)}
            rows={5}
            value={customFieldsDraft}
          />
        </Form.Item>
        {includesWait ? (
          <Form.Item label="Wait for reply outcome">
            <Select
              onChange={setWaitOutcome}
              options={[
                { label: 'Reply matched', value: 'reply' },
                { label: 'Timeout', value: 'timeout' },
              ]}
              value={waitOutcome}
            />
          </Form.Item>
        ) : null}
        {includesHttp ? (
          <Form.Item label="External HTTP outcome">
            <Select
              onChange={setHttpOutcome}
              options={[
                { label: 'Success path', value: 'success' },
                { label: 'Failure path', value: 'failure' },
              ]}
              value={httpOutcome}
            />
          </Form.Item>
        ) : null}
        {validationErrors.length ? (
          <div className="automation-test-validation">
            <strong>Fix the graph before testing</strong>
            {validationErrors.map((error) => (
              <small key={error}>{error}</small>
            ))}
          </div>
        ) : null}
        <Button
          disabled={validationErrors.length > 0}
          loading={loading}
          onClick={() => void run()}
          type="primary"
        >
          Run safe test
        </Button>
      </Form>
      {result ? (
        <>
          <Alert
            message={result.completed ? 'Simulation completed' : 'Simulation is waiting'}
            showIcon
            type={result.completed ? 'success' : 'warning'}
          />
          <Timeline
            items={result.steps.map((step) => ({
              children: (
                <Space direction="vertical" size={0}>
                  <Typography.Text strong>{nodeLabels[step.nodeId] ?? step.nodeId}</Typography.Text>
                  <Typography.Text type="secondary">
                    {step.result === 'WOULD_EXECUTE' ? 'Would execute' : step.result.toLowerCase()}
                  </Typography.Text>
                  {step.reasonCode ? (
                    <Typography.Text type="secondary">{step.reasonCode}</Typography.Text>
                  ) : null}
                  {step.selectedOutput ? (
                    <Typography.Text type="secondary">
                      {step.selectedOutput} →{' '}
                      {step.nextNodeId ? (nodeLabels[step.nextNodeId] ?? step.nextNodeId) : 'End'}
                    </Typography.Text>
                  ) : null}
                </Space>
              ),
              color:
                step.result === 'COMPLETED'
                  ? 'green'
                  : step.result === 'WAITING'
                    ? 'orange'
                    : 'blue',
            }))}
          />
        </>
      ) : null}
    </Space>
  );
}
