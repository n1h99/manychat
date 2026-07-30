import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Popconfirm,
  Result,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { useState } from 'react';
import { useParams } from 'react-router';

import {
  type CrmOperation,
  type CrmPairing,
  useCrmConnectionMutations,
  useCrmOperations,
  useCrmProjectConfig,
  useRetryCrmOperation,
  useSaveCrmProjectConfig,
} from '../crm-api';
import { hasProjectPermission, useProjectAccess } from '../project-access';

export function CrmConfigPage() {
  const { projectId } = useParams();
  const access = useProjectAccess(projectId);
  const config = useCrmProjectConfig(projectId);
  const operations = useCrmOperations(projectId);
  const retry = useRetryCrmOperation(projectId);
  const save = useSaveCrmProjectConfig(projectId);
  const connectionMutations = useCrmConnectionMutations(projectId);
  const [pairing, setPairing] = useState<CrmPairing>();
  if (access.isLoading || config.isLoading) return <Spin />;
  if (!hasProjectPermission(access.data, 'integrations:manage'))
    return (
      <Result
        status="403"
        title="Access denied"
        subTitle="Integration management permission is required."
      />
    );
  const initialValues = config.data
    ? { ...config.data, fieldMapping: JSON.stringify(config.data.fieldMapping, null, 2) }
    : { enabled: true, fieldMapping: '{}' };
  return (
    <section>
      <div className="page-heading">
        <div>
          <Typography.Text className="header-kicker">Integrations</Typography.Text>
          <Typography.Title level={2}>CRM integration</Typography.Title>
          <Typography.Text type="secondary">
            Secure project routing, field mapping and delivery diagnostics.
          </Typography.Text>
        </div>
      </div>
      <Alert
        className="form-alert"
        showIcon
        type="info"
        message="Cyber Pulse CRM"
        description="Здесь настраиваются project routing и mapping для подключённой Cyber Pulse CRM."
      />
      <Card className="crm-connection-card" title="Project CRM connection">
        <Descriptions
          column={2}
          items={[
            {
              key: 'status',
              label: 'Status',
              children: <Tag>{config.data?.status ?? 'DRAFT'}</Tag>,
            },
            {
              key: 'provider',
              label: 'Provider',
              children: config.data?.provider ?? 'CYBER_PULSE',
            },
            { key: 'baseUrl', label: 'CRM URL', children: config.data?.baseUrl ?? 'Not paired' },
            {
              key: 'tested',
              label: 'Last test',
              children: config.data?.lastTestedAt
                ? new Date(config.data.lastTestedAt).toLocaleString()
                : 'Never',
            },
          ]}
          size="small"
        />
        <Typography.Paragraph type="secondary">
          Generate a one-time code, then enter the Omnicus API URL and code on the CRM Integrations
          page. Per-project credentials are exchanged automatically and are never shown again.
        </Typography.Paragraph>
        {pairing ? (
          <Alert
            description={
              <>
                <div>Omnicus API URL: {pairing.omnicusApiUrl}</div>
                <div>Pairing code: {pairing.pairingCode}</div>
                <div>Expires: {new Date(pairing.expiresAt).toLocaleString()}</div>
              </>
            }
            message="Copy these values to CRM"
            showIcon
            type="success"
          />
        ) : null}
        <Button
          loading={connectionMutations.pairing.isPending}
          onClick={async () => {
            const crmProjectId = config.data?.crmProjectId;
            if (!crmProjectId) {
              void message.error('Save CRM project ID first.');
              return;
            }
            setPairing(await connectionMutations.pairing.mutateAsync(crmProjectId));
          }}
        >
          {config.data?.paired ? 'Rotate / pair again' : 'Generate pairing code'}
        </Button>{' '}
        <Button
          disabled={!config.data?.paired}
          loading={connectionMutations.test.isPending}
          onClick={async () => {
            const result = await connectionMutations.test.mutateAsync();
            if (result.ok) void message.success('CRM connection verified.');
            else void message.error('CRM connection test failed.');
          }}
        >
          Test connection
        </Button>{' '}
        <Popconfirm
          title="Disable this CRM connection?"
          onConfirm={() => connectionMutations.disable.mutateAsync()}
        >
          <Button danger disabled={!config.data}>
            Disable
          </Button>
        </Popconfirm>
      </Card>
      <Form
        className="settings-form surface crm-routing-form"
        initialValues={initialValues}
        layout="vertical"
        onFinish={async (values: {
          crmProjectId: string;
          defaultPipeline?: string;
          defaultStage?: string;
          enabled: boolean;
          fieldMapping: string;
        }) => {
          try {
            const fieldMapping = values.fieldMapping
              ? (JSON.parse(values.fieldMapping) as Record<string, unknown>)
              : {};
            await save.mutateAsync({
              crmProjectId: values.crmProjectId,
              defaultPipeline: values.defaultPipeline || null,
              defaultStage: values.defaultStage || null,
              enabled: values.enabled,
              fieldMapping,
            });
            void message.success('CRM configuration сохранена.');
          } catch {
            void message.error('Не удалось сохранить конфигурацию. Проверьте JSON mapping.');
          }
        }}
      >
        <Form.Item label="CRM project ID" name="crmProjectId" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Default pipeline" name="defaultPipeline">
          <Input />
        </Form.Item>
        <Form.Item label="Default stage" name="defaultStage">
          <Input />
        </Form.Item>
        <Form.Item label="Field mapping (JSON)" name="fieldMapping" normalize={(value) => value}>
          <Input.TextArea autoSize={{ minRows: 5 }} />
        </Form.Item>
        <Form.Item label="Enable CRM integration" name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Button htmlType="submit" loading={save.isPending} type="primary">
          Save configuration
        </Button>
      </Form>
      <Typography.Title className="section-heading-title" level={3}>
        CRM operation journal
      </Typography.Title>
      <Alert
        className="form-alert"
        showIcon
        type="warning"
        message="Unknown delivery requires confirmation"
        description="Повтор UNKNOWN-операции возможен только после проверки, что внешняя CRM не применила запрос. Это защищает от слепого дублирования side effect."
      />
      <Table<CrmOperation>
        dataSource={operations.data ?? []}
        loading={operations.isLoading}
        locale={{
          emptyText: operations.isError
            ? 'Не удалось загрузить журнал операций.'
            : 'CRM operations пока нет.',
        }}
        pagination={{ pageSize: 10, showSizeChanger: false }}
        rowKey="id"
        columns={[
          { dataIndex: 'type', key: 'type', title: 'Operation' },
          {
            dataIndex: 'status',
            key: 'status',
            render: (status: CrmOperation['status']) => <Tag>{status}</Tag>,
            title: 'Status',
          },
          { dataIndex: 'attempts', key: 'attempts', title: 'Attempts' },
          { dataIndex: 'lastError', key: 'lastError', title: 'Safe error' },
          {
            key: 'retry',
            render: (_value: unknown, record: CrmOperation) =>
              record.status === 'FAILED' || record.status === 'UNKNOWN' ? (
                <Popconfirm
                  cancelText="Cancel"
                  description={
                    record.status === 'UNKNOWN'
                      ? 'The CRM may already have applied this operation. Continue only after reconciliation.'
                      : 'Requeue this failed CRM operation?'
                  }
                  okText="Retry"
                  onConfirm={async () => {
                    try {
                      await retry.mutateAsync({
                        confirmUnknownDelivery: record.status === 'UNKNOWN',
                        operationId: record.id,
                      });
                      void message.success('CRM operation queued for retry.');
                    } catch {
                      void message.error('Unable to retry the CRM operation.');
                    }
                  }}
                  title="Retry CRM operation?"
                >
                  <Button loading={retry.isPending} size="small">
                    Retry
                  </Button>
                </Popconfirm>
              ) : null,
            title: 'Action',
          },
        ]}
      />
    </section>
  );
}
