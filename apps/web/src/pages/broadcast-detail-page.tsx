import {
  Alert,
  Button,
  Descriptions,
  Modal,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { useParams } from 'react-router';

import { useBroadcast, useBroadcastMutations, useBroadcastRecipients } from '../broadcasts-api';
import { hasProjectPermission, useProjectAccess } from '../project-access';

export function BroadcastDetailPage() {
  const { projectId, broadcastId } = useParams();
  const query = useBroadcast(projectId, broadcastId);
  const recipients = useBroadcastRecipients(projectId, broadcastId);
  const access = useProjectAccess(projectId);
  const mutations = useBroadcastMutations(projectId);
  if (query.isLoading || !query.data) return <Spin />;
  const broadcast = query.data;
  const canLaunch = hasProjectPermission(access.data, 'broadcasts:launch');
  const canPause = hasProjectPermission(access.data, 'broadcasts:pause');
  const canCancel = hasProjectPermission(access.data, 'broadcasts:cancel');
  const action = async (operation: () => Promise<unknown>, success: string) => {
    try {
      await operation();
      void message.success(success);
    } catch {
      void message.error('Операция не выполнена. Проверьте текущий статус рассылки.');
    }
  };
  return (
    <section>
      <Typography.Title level={2}>{broadcast.name}</Typography.Title>
      <Descriptions
        bordered
        column={1}
        items={[
          { key: 'status', label: 'Статус', children: <Tag>{broadcast.status}</Tag> },
          { key: 'audience', label: 'Аудитория', children: broadcast.audience.mode },
          { key: 'text', label: 'Текст', children: broadcast.text },
          { key: 'total', label: 'Получатели', children: broadcast.recipientCount },
          {
            key: 'errorCode',
            label: 'Safe error',
            children: broadcast.errorCode ?? '—',
          },
        ]}
      />
      <Space wrap style={{ marginTop: 16 }}>
        {canLaunch && ['DRAFT', 'SCHEDULED'].includes(broadcast.status) ? (
          <Button
            loading={mutations.launch.isPending}
            type="primary"
            onClick={() =>
              void action(
                () => mutations.launch.mutateAsync(broadcast.id),
                'Рассылка поставлена в очередь.',
              )
            }
          >
            Запустить
          </Button>
        ) : null}
        {canPause && broadcast.status === 'RUNNING' ? (
          <Button
            onClick={() =>
              void action(
                () => mutations.pause.mutateAsync(broadcast.id),
                'Рассылка приостановлена.',
              )
            }
          >
            Пауза
          </Button>
        ) : null}
        {canLaunch && broadcast.status === 'PAUSED' ? (
          <Button
            onClick={() =>
              void action(() => mutations.resume.mutateAsync(broadcast.id), 'Рассылка продолжена.')
            }
          >
            Продолжить
          </Button>
        ) : null}
        {canLaunch && broadcast.status === 'RUNNING' ? (
          <Button
            onClick={() =>
              void action(
                () => mutations.retryFailed.mutateAsync(broadcast.id),
                'Неуспешные получатели снова поставлены в очередь.',
              )
            }
          >
            Повторить failed
          </Button>
        ) : null}
        {canCancel &&
        ['DRAFT', 'SCHEDULED', 'PREPARING', 'RUNNING', 'PAUSED'].includes(broadcast.status) ? (
          <Button
            danger
            onClick={() =>
              Modal.confirm({
                title: 'Отменить рассылку?',
                onOk: () =>
                  action(() => mutations.cancel.mutateAsync(broadcast.id), 'Рассылка отменена.'),
              })
            }
          >
            Отменить
          </Button>
        ) : null}
      </Space>
      <Typography.Title level={4}>Получатели</Typography.Title>
      {recipients.isError ? (
        <Alert message="Не удалось загрузить получателей рассылки." showIcon type="error" />
      ) : null}
      <Table
        rowKey="id"
        loading={recipients.isLoading}
        dataSource={recipients.data?.items ?? []}
        pagination={false}
        columns={[
          { title: 'Контакт', dataIndex: ['contact', 'displayName'] },
          {
            title: 'Telegram',
            dataIndex: ['channelIdentity', 'username'],
            render: (value) => value ?? '—',
          },
          { title: 'Статус', dataIndex: 'status', render: (value) => <Tag>{value}</Tag> },
          { title: 'Код ошибки', dataIndex: 'lastError', render: (value) => value ?? '—' },
        ]}
      />
    </section>
  );
}
