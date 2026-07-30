import { Button, Form, Input, Select, Space, Spin, Typography, message } from 'antd';
import { useNavigate, useParams } from 'react-router';

import { useBroadcastMutations } from '../broadcasts-api';
import { useChannels } from '../channels-api';
import { useTemplates } from '../templates-api';

export function BroadcastCreatePage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const channels = useChannels(projectId);
  const templates = useTemplates(projectId);
  const mutations = useBroadcastMutations(projectId);
  const [form] = Form.useForm();
  const contentMode = Form.useWatch('contentMode', form) ?? 'TEXT';
  if (channels.isLoading || templates.isLoading)
    return <Spin className="route-loading" size="large" />;
  return (
    <section className="narrow-page">
      <div className="page-heading">
        <div>
          <Typography.Text className="header-kicker">New campaign</Typography.Text>
          <Typography.Title level={2}>New Telegram broadcast</Typography.Title>
          <Typography.Text type="secondary">
            The audience and published template version are snapshotted at launch.
          </Typography.Text>
        </div>
      </div>
      <Form
        className="settings-form surface"
        form={form}
        initialValues={{ audienceMode: 'ALL_ACTIVE', contentMode: 'TEXT' }}
        layout="vertical"
        onFinish={async (values: {
          audienceMode: 'ALL_ACTIVE';
          connectionId: string;
          contentMode: 'TEMPLATE' | 'TEXT';
          name: string;
          templateVersionId?: string;
          text?: string;
        }) => {
          try {
            if (values.contentMode === 'TEMPLATE' && !values.templateVersionId)
              throw new Error('A template version is required');
            if (values.contentMode === 'TEXT' && !values.text)
              throw new Error('Message text is required');
            const broadcast = await mutations.create.mutateAsync({
              audience: { mode: values.audienceMode },
              connectionId: values.connectionId,
              name: values.name,
              ...(values.contentMode === 'TEMPLATE'
                ? { templateVersionId: values.templateVersionId! }
                : { text: values.text! }),
            });
            void message.success('Broadcast draft created.');
            void navigate(`/projects/${projectId}/broadcasts/${broadcast.id}`);
          } catch {
            void message.error('Broadcast could not be created.');
          }
        }}
      >
        <Form.Item label="Name" name="name" rules={[{ required: true }]}>
          <Input maxLength={120} />
        </Form.Item>
        <Form.Item label="Telegram channel" name="connectionId" rules={[{ required: true }]}>
          <Select
            options={(channels.data ?? [])
              .filter((channel) => channel.status === 'ACTIVE')
              .map((channel) => ({
                label: `${channel.name}${channel.botUsername ? ` (@${channel.botUsername})` : ''}`,
                value: channel.id,
              }))}
          />
        </Form.Item>
        <Form.Item label="Audience" name="audienceMode">
          <Select options={[{ label: 'All active Telegram contacts', value: 'ALL_ACTIVE' }]} />
        </Form.Item>
        <Form.Item label="Content" name="contentMode">
          <Select
            options={[
              { label: 'Text', value: 'TEXT' },
              { label: 'Published template', value: 'TEMPLATE' },
            ]}
          />
        </Form.Item>
        {contentMode === 'TEMPLATE' ? (
          <Form.Item label="Template" name="templateVersionId" rules={[{ required: true }]}>
            <Select
              options={(templates.data ?? [])
                .filter((template) => template.status === 'PUBLISHED' && template.activeVersion)
                .map((template) => ({
                  label: `${template.name} (${template.activeVersion!.kind})`,
                  value: template.activeVersion!.id,
                }))}
            />
          </Form.Item>
        ) : (
          <Form.Item label="Text" name="text" rules={[{ required: true }]}>
            <Input.TextArea maxLength={4096} rows={6} />
          </Form.Item>
        )}
        <Space>
          <Button htmlType="submit" loading={mutations.create.isPending} type="primary">
            Create
          </Button>
          <Button onClick={() => navigate(-1)}>Cancel</Button>
        </Space>
      </Form>
    </section>
  );
}
