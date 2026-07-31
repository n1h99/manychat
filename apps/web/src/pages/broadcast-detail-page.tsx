import { CopyOutlined, InboxOutlined } from '@ant-design/icons';
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
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { useBroadcast, useBroadcastMutations, useBroadcastRecipients } from '../broadcasts-api';
import { hasProjectPermission, useProjectAccess } from '../project-access';

export function BroadcastDetailPage() {
  const { projectId, broadcastId } = useParams();
  const navigate = useNavigate();
  const [removing, setRemoving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const query = useBroadcast(projectId, broadcastId);
  const recipients = useBroadcastRecipients(projectId, broadcastId);
  const access = useProjectAccess(projectId);
  const mutations = useBroadcastMutations(projectId);
  if (query.isLoading || !query.data) return <Spin className="route-loading" size="large" />;
  const broadcast = query.data;
  const canLaunch = hasProjectPermission(access.data, 'broadcasts:launch');
  const canCreate = hasProjectPermission(access.data, 'broadcasts:create');
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
      <div className="page-heading-row broadcast-detail-heading">
        <div>
          <Typography.Title level={2}>{broadcast.name}</Typography.Title>
          <Typography.Text type="secondary">
            Delivery configuration and immutable recipient history.
          </Typography.Text>
        </div>
        <Space wrap>
          {canCreate &&
          ['COMPLETED', 'CANCELLED', 'FAILED', 'ARCHIVED'].includes(broadcast.status) ? (
            <Button icon={<CopyOutlined />} onClick={() => setRestarting(true)} type="primary">
              Run again
            </Button>
          ) : null}
          {canCancel &&
          !['PREPARING', 'RUNNING', 'PAUSED', 'ARCHIVED'].includes(broadcast.status) ? (
            <Button danger icon={<InboxOutlined />} onClick={() => setRemoving(true)}>
              Archive
            </Button>
          ) : null}
        </Space>
      </div>
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
                centered: true,
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
      <Modal
        cancelText="Keep broadcast"
        centered
        okButtonProps={{ danger: true, loading: mutations.remove.isPending }}
        okText="Archive broadcast"
        onCancel={() => setRemoving(false)}
        onOk={async () => {
          await mutations.remove.mutateAsync(broadcast.id);
          setRemoving(false);
          void navigate(`/projects/${projectId}/broadcasts`, { replace: true });
        }}
        open={removing}
        title="Archive this broadcast?"
      >
        The broadcast will be archived and removed from the project list. Recipient history remains
        protected for audit.
      </Modal>
      <Modal
        cancelText="Cancel"
        centered
        okButtonProps={{ loading: mutations.runAgain.isPending }}
        okText="Create new draft"
        onCancel={() => setRestarting(false)}
        onOk={async () => {
          const copy = await mutations.runAgain.mutateAsync(broadcast.id);
          setRestarting(false);
          void message.success('A new broadcast draft was created.');
          void navigate(`/projects/${projectId}/broadcasts/${copy.id}`);
        }}
        open={restarting}
        title="Run this broadcast again?"
      >
        A new draft with the same content and audience rules will be created. Recipients will be
        recalculated when you launch it, while this delivery history remains unchanged.
      </Modal>
    </section>
  );
}
