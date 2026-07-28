import {
  Button,
  Descriptions,
  Divider,
  Form,
  Input,
  Modal,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import { useRef } from 'react';
import { useParams } from 'react-router';
import { useChannel, useChannelMutations } from '../channels-api';
import { hasProjectPermission, useProjectAccess } from '../project-access';
function key() {
  return crypto.randomUUID();
}
export function ChannelDetailPage() {
  const { projectId, connectionId } = useParams();
  const q = useChannel(projectId, connectionId);
  const m = useChannelMutations(projectId);
  const access = useProjectAccess(projectId);
  const retry = useRef<string | undefined>(undefined);
  if (q.isLoading) return <Typography.Text>Загрузка…</Typography.Text>;
  if (!q.data) return <Typography.Text type="danger">Канал не найден.</Typography.Text>;
  const c = q.data;
  const canManage = hasProjectPermission(access.data, 'channels:manage');
  const canRotateSecrets = hasProjectPermission(access.data, 'channels:rotate_secrets');
  const action = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      message.success(ok);
    } catch {
      message.error('Операция не выполнена. Проверьте статус подключения.');
    }
  };
  return (
    <section>
      <Typography.Title level={2}>{c.name}</Typography.Title>
      <Descriptions
        bordered
        column={1}
        items={[
          { key: 'type', label: 'Тип', children: c.type },
          { key: 'status', label: 'Статус', children: <Tag>{c.status}</Tag> },
          { key: 'bot', label: 'Бот', children: c.botUsername ?? '—' },
          { key: 'id', label: 'External bot ID', children: c.externalBotId ?? '—' },
          { key: 'token', label: 'Токен', children: c.maskedToken ?? '—' },
          { key: 'wh', label: 'Webhook', children: c.webhookStatus },
          {
            key: 'lastWebhookAt',
            label: 'Последний webhook',
            children: c.lastWebhookAt ? new Date(c.lastWebhookAt).toLocaleString() : '—',
          },
          {
            key: 'lastErrorAt',
            label: 'Последняя ошибка',
            children: c.lastErrorAt ? new Date(c.lastErrorAt).toLocaleString() : '—',
          },
          { key: 'updated', label: 'Обновлён', children: new Date(c.updatedAt).toLocaleString() },
        ]}
      />
      {canManage ? (
        <>
          <Space wrap style={{ marginTop: 16 }}>
            <Button
              onClick={() => void action(() => m.test.mutateAsync(c.id), 'Соединение проверено')}
            >
              Проверить соединение
            </Button>
            <Button
              onClick={() => void action(() => m.connect.mutateAsync(c.id), 'Webhook подключён')}
            >
              Подключить webhook
            </Button>
            <Button
              danger
              onClick={() =>
                Modal.confirm({
                  title: 'Отключить канал?',
                  onOk: () => action(() => m.disable.mutateAsync(c.id), 'Канал отключён'),
                })
              }
            >
              Отключить
            </Button>
            {canRotateSecrets ? (
              <Button
                onClick={() =>
                  Modal.confirm({
                    title: 'Ротировать webhook secret?',
                    onOk: () => action(() => m.rotate.mutateAsync(c.id), 'Webhook secret обновлён'),
                  })
                }
              >
                Ротировать secret
              </Button>
            ) : null}
          </Space>
          <Divider />
          <Typography.Title level={4}>Заменить bot token</Typography.Title>
          <Form
            layout="inline"
            onFinish={async (v) => {
              await action(
                () => m.update.mutateAsync({ id: c.id, botToken: v.botToken }),
                'Токен заменён',
              );
            }}
          >
            <Form.Item name="botToken" rules={[{ required: true }]}>
              <Input.Password autoComplete="new-password" placeholder="Новый token" />
            </Form.Item>
            <Button htmlType="submit">Заменить</Button>
          </Form>
          <Divider />
          <Typography.Title level={4}>Тестовое сообщение</Typography.Title>
          <Form
            layout="vertical"
            onFinish={async (v) => {
              retry.current ??= key();
              await action(
                () => m.send.mutateAsync({ id: c.id, ...v, idempotencyKey: retry.current! }),
                'Сообщение поставлено в очередь',
              );
              retry.current = undefined;
            }}
          >
            <Form.Item
              label="Channel identity ID"
              name="channelIdentityId"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
            <Form.Item label="Текст" name="text" rules={[{ required: true }]}>
              <Input.TextArea />
            </Form.Item>
            <Form.Item label="Без уведомления" name="disableNotification" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Button htmlType="submit" loading={m.send.isPending} type="primary">
              Поставить в очередь
            </Button>
          </Form>
        </>
      ) : null}
    </section>
  );
}
