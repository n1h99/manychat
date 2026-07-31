import { DeleteOutlined, PauseOutlined, PlayCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Modal, Space, Spin, Table, Tag, Typography, message } from 'antd';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { type Broadcast, useBroadcastMutations, useBroadcasts } from '../broadcasts-api';
import { hasProjectPermission, useProjectAccess } from '../project-access';

export function BroadcastsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const access = useProjectAccess(projectId);
  const query = useBroadcasts(projectId);
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
          <Typography.Text className="header-kicker">Campaigns</Typography.Text>
          <Typography.Title level={2}>Broadcasts</Typography.Title>
          <Typography.Text type="secondary">
            Telegram campaigns with an immutable recipient snapshot.
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
          { dataIndex: 'name', title: 'Name' },
          { dataIndex: 'status', render: (value) => <Tag>{value}</Tag>, title: 'Status' },
          { dataIndex: 'recipientCount', title: 'Recipients' },
          {
            dataIndex: 'updatedAt',
            render: (value) => new Date(value).toLocaleString(),
            title: 'Updated',
          },
          ...(canPause || canArchive
            ? [
                {
                  key: 'actions',
                  render: (_: unknown, broadcast: Broadcast) => (
                    <Space onClick={(event) => event.stopPropagation()}>
                      {canPause && broadcast.status === 'RUNNING' ? (
                        <Button
                          icon={<PauseOutlined />}
                          onClick={() => void mutations.pause.mutateAsync(broadcast.id)}
                          size="small"
                        >
                          Deactivate
                        </Button>
                      ) : canPause && broadcast.status === 'PAUSED' ? (
                        <Button
                          icon={<PlayCircleOutlined />}
                          onClick={() => void mutations.resume.mutateAsync(broadcast.id)}
                          size="small"
                        >
                          Resume
                        </Button>
                      ) : null}
                      {canArchive &&
                      !['PREPARING', 'RUNNING', 'PAUSED'].includes(broadcast.status) ? (
                        <Button
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => setRemoving(broadcast)}
                          size="small"
                        >
                          Delete
                        </Button>
                      ) : null}
                    </Space>
                  ),
                  title: 'Actions',
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
        okButtonProps={{ danger: true, loading: mutations.remove.isPending }}
        okText="Delete broadcast"
        onCancel={() => setRemoving(undefined)}
        onOk={async () => {
          if (!removing) return;
          await mutations.remove.mutateAsync(removing.id);
          setRemoving(undefined);
          void message.success('Broadcast deleted.');
        }}
        open={Boolean(removing)}
        title="Delete this broadcast?"
      >
        The broadcast will be archived and removed from this list. Delivery history remains
        available for audit.
      </Modal>
    </section>
  );
}
