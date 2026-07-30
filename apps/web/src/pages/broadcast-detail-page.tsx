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
  if (query.isLoading || !query.data) return <Spin className="route-loading" size="large" />;
  const broadcast = query.data;
  const canLaunch = hasProjectPermission(access.data, 'broadcasts:launch');
  const canPause = hasProjectPermission(access.data, 'broadcasts:pause');
  const canCancel = hasProjectPermission(access.data, 'broadcasts:cancel');
  const action = async (operation: () => Promise<unknown>, success: string) => {
    try {
      await operation();
      void message.success(success);
    } catch {
      void message.error('The operation failed. Check the current broadcast status.');
    }
  };
  return (
    <section>
      <Typography.Title level={2}>{broadcast.name}</Typography.Title>
      <Descriptions
        bordered
        column={1}
        items={[
          { key: 'status', label: 'Status', children: <Tag>{broadcast.status}</Tag> },
          { key: 'audience', label: 'Audience', children: broadcast.audience.mode },
          { key: 'text', label: 'Message', children: broadcast.text },
          { key: 'total', label: 'Recipients', children: broadcast.recipientCount },
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
              void action(() => mutations.launch.mutateAsync(broadcast.id), 'Broadcast queued.')
            }
          >
            Launch
          </Button>
        ) : null}
        {canPause && broadcast.status === 'RUNNING' ? (
          <Button
            onClick={() =>
              void action(() => mutations.pause.mutateAsync(broadcast.id), 'Broadcast paused.')
            }
          >
            Pause
          </Button>
        ) : null}
        {canLaunch && broadcast.status === 'PAUSED' ? (
          <Button
            onClick={() =>
              void action(() => mutations.resume.mutateAsync(broadcast.id), 'Broadcast resumed.')
            }
          >
            Resume
          </Button>
        ) : null}
        {canLaunch && broadcast.status === 'RUNNING' ? (
          <Button
            onClick={() =>
              void action(
                () => mutations.retryFailed.mutateAsync(broadcast.id),
                'Failed recipients queued again.',
              )
            }
          >
            Retry failed
          </Button>
        ) : null}
        {canCancel &&
        ['DRAFT', 'SCHEDULED', 'PREPARING', 'RUNNING', 'PAUSED'].includes(broadcast.status) ? (
          <Button
            danger
            onClick={() =>
              Modal.confirm({
                title: 'Cancel this broadcast?',
                onOk: () =>
                  action(() => mutations.cancel.mutateAsync(broadcast.id), 'Broadcast cancelled.'),
              })
            }
          >
            Cancel
          </Button>
        ) : null}
      </Space>
      <Typography.Title level={4}>Recipients</Typography.Title>
      {recipients.isError ? (
        <Alert message="Broadcast recipients could not be loaded." showIcon type="error" />
      ) : null}
      <Table
        rowKey="id"
        loading={recipients.isLoading}
        dataSource={recipients.data?.items ?? []}
        pagination={false}
        columns={[
          { title: 'Contact', dataIndex: ['contact', 'displayName'] },
          {
            title: 'Telegram',
            dataIndex: ['channelIdentity', 'username'],
            render: (value) => value ?? '—',
          },
          { title: 'Status', dataIndex: 'status', render: (value) => <Tag>{value}</Tag> },
          { title: 'Error code', dataIndex: 'lastError', render: (value) => value ?? '—' },
        ]}
      />
    </section>
  );
}
