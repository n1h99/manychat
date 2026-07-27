import { Button, Form, Input, Select, Space, Spin, Typography, message } from 'antd';
import { useNavigate, useParams } from 'react-router';

import { useBroadcastMutations } from '../broadcasts-api';
import { useChannels } from '../channels-api';

export function BroadcastCreatePage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const channels = useChannels(projectId);
  const mutations = useBroadcastMutations(projectId);
  if (channels.isLoading) return <Spin />;
  return (
    <section>
      <Typography.Title level={2}>Новая Telegram-рассылка</Typography.Title>
      <Typography.Paragraph type="secondary">
        Текст и аудитория фиксируются при запуске. Полный текст не добавляется в audit log.
      </Typography.Paragraph>
      <Form
        layout="vertical"
        initialValues={{ audienceMode: 'ALL_ACTIVE' }}
        onFinish={async (values: {
          audienceMode: 'ALL_ACTIVE' | 'SEGMENT' | 'CONTACTS';
          connectionId: string;
          name: string;
          segmentId?: string;
          text: string;
        }) => {
          try {
            const broadcast = await mutations.create.mutateAsync({
              name: values.name,
              connectionId: values.connectionId,
              text: values.text,
              audience: {
                mode: values.audienceMode,
                ...(values.segmentId ? { segmentId: values.segmentId } : {}),
              },
            });
            void message.success('Черновик рассылки создан.');
            navigate(`/projects/${projectId}/broadcasts/${broadcast.id}`);
          } catch {
            void message.error('Не удалось создать рассылку. Проверьте канал и поля формы.');
          }
        }}
      >
        <Form.Item label="Название" name="name" rules={[{ required: true }]}>
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
        <Form.Item label="Аудитория" name="audienceMode">
          <Select options={[{ label: 'Все активные Telegram-контакты', value: 'ALL_ACTIVE' }]} />
        </Form.Item>
        <Form.Item label="Текст" name="text" rules={[{ required: true }]}>
          <Input.TextArea maxLength={4096} rows={6} />
        </Form.Item>
        <Space>
          <Button htmlType="submit" loading={mutations.create.isPending} type="primary">
            Создать
          </Button>
          <Button onClick={() => navigate(-1)}>Отмена</Button>
        </Space>
      </Form>
    </section>
  );
}
