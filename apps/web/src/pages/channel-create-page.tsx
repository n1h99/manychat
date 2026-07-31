import { ArrowLeftOutlined, SendOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, Space, Typography, message } from 'antd';
import { useNavigate, useParams } from 'react-router';

import { useChannelMutations } from '../channels-api';

export function ChannelCreatePage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [form] = Form.useForm<{ name: string; botToken: string }>();
  const mutations = useChannelMutations(projectId);

  return (
    <section className="narrow-page">
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>Connect Telegram</Typography.Title>
          <Typography.Text type="secondary">
            Add a bot to begin receiving contacts and messages.
          </Typography.Text>
        </div>
      </div>
      <Card>
        <Alert
          className="form-alert"
          description="After saving, the full token is encrypted and never displayed again. You will connect the webhook on the next screen."
          message="Get the bot token from BotFather"
          showIcon
          type="info"
        />
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            try {
              const channel = await mutations.create.mutateAsync(values);
              form.resetFields();
              void navigate(`/projects/${projectId}/channels/${channel.id}`);
            } catch {
              void message.error('Telegram could not be connected. Check the bot token.');
            }
          }}
        >
          <Form.Item label="Connection name" name="name" rules={[{ required: true }]}>
            <Input autoComplete="off" placeholder="Customer support bot" />
          </Form.Item>
          <Form.Item
            extra="The token remains only in this form until it is submitted."
            label="Bot token"
            name="botToken"
            rules={[{ required: true }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Space>
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate(`/projects/${projectId}/channels`)}
            >
              Cancel
            </Button>
            <Button
              htmlType="submit"
              icon={<SendOutlined />}
              loading={mutations.create.isPending}
              type="primary"
            >
              Create connection
            </Button>
          </Space>
        </Form>
      </Card>
    </section>
  );
}
