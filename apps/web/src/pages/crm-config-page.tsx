import { Alert, Button, Form, Input, Result, Spin, Switch, Typography, message } from 'antd';
import { useParams } from 'react-router';

import { useCrmProjectConfig, useSaveCrmProjectConfig } from '../crm-api';
import { hasProjectPermission, useProjectAccess } from '../project-access';

export function CrmConfigPage() {
  const { projectId } = useParams();
  const access = useProjectAccess(projectId);
  const config = useCrmProjectConfig(projectId);
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
      <Typography.Title level={2}>CRM mock</Typography.Title>
      <Alert
        showIcon
        type="info"
        message="Pilot mock adapter"
        description="Здесь задаётся только project routing и mapping. Production CRM API не подключён до получения подтверждённого контракта."
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
            void message.success('CRM mock configuration сохранена.');
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
        <Form.Item label="Enable mock CRM" name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Button htmlType="submit" loading={save.isPending} type="primary">
          Save configuration
        </Button>
      </Form>
    </section>
  );
}
