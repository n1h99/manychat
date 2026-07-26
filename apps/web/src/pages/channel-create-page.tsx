import { Alert, Button, Form, Input, Typography, message } from 'antd';
import { useNavigate, useParams } from 'react-router';
import { useChannelMutations } from '../channels-api';
export function ChannelCreatePage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [form] = Form.useForm<{ name: string; botToken: string }>();
  const m = useChannelMutations(projectId);
  return (
    <section>
      <Typography.Title level={2}>Подключить Telegram</Typography.Title>
      <Alert
        showIcon
        type="info"
        message="Токен берётся у BotFather. После сохранения полный токен больше не показывается; затем подключите webhook."
      />
      <Form
        form={form}
        layout="vertical"
        onFinish={async (values) => {
          try {
            const channel = await m.create.mutateAsync(values);
            form.resetFields();
            void navigate(`/projects/${projectId}/channels/${channel.id}`);
          } catch {
            message.error('Не удалось подключить Telegram. Проверьте токен.');
          }
        }}
      >
        <Form.Item label="Название" name="name" rules={[{ required: true }]}>
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item label="Bot token" name="botToken" rules={[{ required: true }]}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Button htmlType="submit" loading={m.create.isPending} type="primary">
          Создать подключение
        </Button>
      </Form>
    </section>
  );
}
