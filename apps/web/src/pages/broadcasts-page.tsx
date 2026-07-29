import { PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Spin, Table, Tag, Typography } from 'antd';
import { useNavigate, useParams } from 'react-router';

import { type Broadcast, useBroadcasts } from '../broadcasts-api';
import { hasProjectPermission, useProjectAccess } from '../project-access';

export function BroadcastsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const access = useProjectAccess(projectId);
  const query = useBroadcasts(projectId);
  const canCreate = hasProjectPermission(access.data, 'broadcasts:create');

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
    </section>
  );
}
