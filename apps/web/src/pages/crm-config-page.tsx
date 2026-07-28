import {
  Alert,
  Button,
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
import { useParams } from 'react-router';

import {
  type CrmOperation,
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
      <Typography.Title level={2}>CRM integration</Typography.Title>
      <Alert
        showIcon
        type="info"
        message="Cyber Pulse CRM"
        description="Здесь настраиваются project routing и mapping для подключённой Cyber Pulse CRM."
      />
      <Form
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
      <Typography.Title level={3}>CRM operation journal</Typography.Title>
      <Alert
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
