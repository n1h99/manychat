import { Button, Empty, Space, Spin, Table, Tag, Typography } from 'antd';
import { useNavigate, useParams } from 'react-router';
import { useChannels, type Channel } from '../channels-api';
export function ChannelsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const query = useChannels(projectId);
  if (query.isLoading) return <Spin />;
  if (query.isError)
    return <Typography.Text type="danger">Не удалось загрузить каналы.</Typography.Text>;
  return (
    <section>
      <Space className="page-heading" direction="vertical" size={0}>
        <Typography.Title level={2}>Каналы</Typography.Title>
        <Typography.Text type="secondary">Подключения Telegram текущего проекта.</Typography.Text>
      </Space>
      <Button type="primary" onClick={() => navigate(`/projects/${projectId}/channels/new`)}>
        Подключить Telegram
      </Button>
      {query.data?.length ? (
        <Table<Channel>
          rowKey="id"
          pagination={false}
          dataSource={query.data}
          onRow={(row) => ({
            onClick: () => navigate(`/projects/${projectId}/channels/${row.id}`),
          })}
          columns={[
            { title: 'Название', dataIndex: 'name' },
            { title: 'Тип', dataIndex: 'type' },
            { title: 'Бот', dataIndex: 'botUsername' },
            { title: 'Статус', dataIndex: 'status', render: (v) => <Tag>{v}</Tag> },
            { title: 'Webhook', dataIndex: 'webhookStatus' },
            {
              title: 'Обновлён',
              dataIndex: 'updatedAt',
              render: (v) => new Date(v).toLocaleString(),
            },
          ]}
        />
      ) : (
        <Empty description="Каналы ещё не подключены" />
      )}
    </section>
  );
}
