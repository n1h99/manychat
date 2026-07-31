import {
  DeleteOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Empty,
  Modal,
  Segmented,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { type Broadcast, useBroadcastMutations, useBroadcasts } from '../broadcasts-api';
import { hasProjectPermission, useProjectAccess } from '../project-access';

export function BroadcastsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const access = useProjectAccess(projectId);
  const [view, setView] = useState<'active' | 'archived'>('active');
  const query = useBroadcasts(projectId, view === 'archived');
  const canCreate = hasProjectPermission(access.data, 'broadcasts:create');
  const canPause = hasProjectPermission(access.data, 'broadcasts:pause');
  const canArchive = hasProjectPermission(access.data, 'broadcasts:cancel');
  const mutations = useBroadcastMutations(projectId);
  const [removing, setRemoving] = useState<Broadcast>();

  if (query.isLoading) return <Spin className="route-loading" />;

  return (
    <section>
      <div className="page-heading-row">
        <div>
          <Typography.Title level={2}>Broadcasts</Typography.Title>
          <Typography.Text type="secondary">
            Telegram broadcasts with an immutable recipient snapshot.
          </Typography.Text>
        </div>
        {canCreate ? (
          <Button
            icon={<PlusOutlined />}
            onClick={() => navigate(`/projects/${projectId}/broadcasts/new`)}
            type="primary"
          >
            Create broadcast
          </Button>
        ) : null}
      </div>
      <Segmented
        className="archive-view-switch"
        onChange={(value) => setView(value as 'active' | 'archived')}
        options={[
          { label: 'Active broadcasts', value: 'active' },
          { label: 'Archived', value: 'archived' },
        ]}
        value={view}
      />
      {query.isError ? (
        <Alert
          className="form-alert"
          message="Broadcasts could not be loaded. Try again shortly."
          showIcon
          type="error"
        />
      ) : null}
      <Table<Broadcast>
        columns={[
          { dataIndex: 'name', title: 'Name', width: '34%' },
          {
            dataIndex: 'status',
            render: (value) => <Tag>{value}</Tag>,
            title: 'Status',
            width: 140,
          },
          { dataIndex: 'recipientCount', title: 'Recipients', width: 120 },
          {
            dataIndex: 'updatedAt',
            render: (value) => new Date(value).toLocaleString(),
            title: 'Updated',
            width: 210,
          },
          ...(canPause || canArchive
            ? [
                {
                  key: 'actions',
                  render: (_: unknown, broadcast: Broadcast) => (
                    <Space
                      className="stable-table-actions"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {view === 'archived' && canArchive ? (
                        <Button
                          icon={<UndoOutlined />}
                          loading={mutations.restore.isPending}
                          onClick={() => void mutations.restore.mutateAsync(broadcast.id)}
                          size="small"
                          type="primary"
                        >
                          Restore
                        </Button>
                      ) : null}
                      {canPause && broadcast.status === 'RUNNING' ? (
                        <Button
                          className="broadcast-state-action"
                          icon={<PauseOutlined />}
                          onClick={() => void mutations.pause.mutateAsync(broadcast.id)}
                          size="small"
                        >
                          Deactivate
                        </Button>
                      ) : canPause && broadcast.status === 'PAUSED' ? (
                        <Button
                          className="broadcast-state-action"
                          icon={<PlayCircleOutlined />}
                          onClick={() => void mutations.resume.mutateAsync(broadcast.id)}
                          size="small"
                        >
                          Resume
                        </Button>
                      ) : null}
                      {view === 'active' &&
                      canArchive &&
                      !['PREPARING', 'RUNNING', 'PAUSED'].includes(broadcast.status) ? (
                        <Button
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => setRemoving(broadcast)}
                          size="small"
                        >
                          Archive
                        </Button>
                      ) : null}
                    </Space>
                  ),
                  title: 'Actions',
                  width: 250,
                },
              ]
            : []),
        ]}
        dataSource={query.data ?? []}
        locale={{
          emptyText: (
            <Empty description="No broadcasts created" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ),
        }}
        onRow={(row) => ({
          onClick: () => navigate(`/projects/${projectId}/broadcasts/${row.id}`),
        })}
        pagination={false}
        rowClassName="clickable-row"
        rowKey="id"
      />
      <Modal
        cancelText="Keep broadcast"
        centered
        okButtonProps={{ danger: true, loading: mutations.remove.isPending }}
        okText="Archive broadcast"
        onCancel={() => setRemoving(undefined)}
        onOk={async () => {
          if (!removing) return;
          await mutations.remove.mutateAsync(removing.id);
          setRemoving(undefined);
          void message.success('Broadcast archived.');
        }}
        open={Boolean(removing)}
        title="Archive this broadcast?"
      >
        The broadcast will be archived and removed from this list. Delivery history remains
        available for audit.
      </Modal>
    </section>
  );
}
