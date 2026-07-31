import { PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Spin, Table, Tag, Typography } from 'antd';
import { useNavigate, useParams } from 'react-router';

import { type Channel, useChannels } from '../channels-api';
import { hasProjectPermission, useProjectAccess } from '../project-access';

export function ChannelsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const query = useChannels(projectId);
  const access = useProjectAccess(projectId);

  if (query.isLoading) return <Spin className="route-loading" />;

  return (
    <section>
      <div className="page-heading-row">
        <div>
          <Typography.Title level={2}>Channels</Typography.Title>
          <Typography.Text type="secondary">
            Telegram connections for the current project.
          </Typography.Text>
        </div>
        {hasProjectPermission(access.data, 'channels:manage') ? (
          <Button
            icon={<PlusOutlined />}
            onClick={() => navigate(`/projects/${projectId}/channels/new`)}
            type="primary"
          >
            Connect Telegram
          </Button>
        ) : null}
      </div>
      {query.isError ? (
        <Alert
          className="form-alert"
          message="Channels could not be loaded. Try again shortly."
          showIcon
          type="error"
        />
      ) : null}
      <Table<Channel>
        columns={[
          { dataIndex: 'name', title: 'Name' },
          { dataIndex: 'type', title: 'Type' },
          {
            dataIndex: 'botUsername',
            render: (value) => (value ? `@${value}` : '—'),
            title: 'Bot',
          },
          {
            dataIndex: 'status',
            render: (value) => (
              <Tag color={value === 'ACTIVE' ? 'green' : value === 'ERROR' ? 'red' : 'default'}>
                {value}
              </Tag>
            ),
            title: 'Status',
          },
          { dataIndex: 'webhookStatus', title: 'Webhook' },
          {
            dataIndex: 'updatedAt',
            render: (value) => new Date(value).toLocaleString(),
            title: 'Updated',
          },
        ]}
        dataSource={query.data ?? []}
        locale={{
          emptyText: (
            <Empty description="No channels connected" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ),
        }}
        onRow={(row) => ({
          onClick: () => navigate(`/projects/${projectId}/channels/${row.id}`),
        })}
        pagination={false}
        rowClassName="clickable-row"
        rowKey="id"
      />
    </section>
  );
}
