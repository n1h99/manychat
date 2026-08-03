import { ApiOutlined, MessageOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Space, Spin, Table, Typography } from 'antd';
import { useNavigate, useParams } from 'react-router';

import { channelAccountLabel, channelProviderLabel } from '../channel-provider';
import { type Channel, useChannels } from '../channels-api';
import { hasProjectPermission, useProjectAccess } from '../project-access';
import { StatusText } from '../status-text';

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
            Connect and monitor Telegram bots and WhatsApp Business numbers.
          </Typography.Text>
        </div>
        {hasProjectPermission(access.data, 'channels:manage') ? (
          <Space className="channel-create-actions" wrap>
            <Button
              icon={<ApiOutlined />}
              onClick={() => navigate(`/projects/${projectId}/channels/new?type=telegram`)}
            >
              Connect Telegram
            </Button>
            <Button
              icon={<MessageOutlined />}
              onClick={() => navigate(`/projects/${projectId}/channels/new?type=whatsapp`)}
              type="primary"
            >
              Connect WhatsApp
            </Button>
          </Space>
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
          {
            dataIndex: 'type',
            render: (value: Channel['type']) => channelProviderLabel(value),
            title: 'Provider',
          },
          {
            render: (_, channel) => channelAccountLabel(channel),
            title: 'Account',
          },
          {
            dataIndex: 'status',
            render: (value) => <StatusText status={value} />,
            title: 'Status',
          },
          {
            dataIndex: 'webhookStatus',
            render: (value) => <StatusText status={value} />,
            title: 'Webhook',
          },
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
