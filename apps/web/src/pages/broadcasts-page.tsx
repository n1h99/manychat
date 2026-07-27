import { Button, Empty, Space, Spin, Table, Tag, Typography } from 'antd';
import { useNavigate, useParams } from 'react-router';

import { type Broadcast, useBroadcasts } from '../broadcasts-api';
import { hasProjectPermission, useProjectAccess } from '../project-access';

export function BroadcastsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const access = useProjectAccess(projectId);
  const query = useBroadcasts(projectId);
  if (query.isLoading) return <Spin />;
  if (query.isError)
    return <Typography.Text type="danger">Не удалось загрузить рассылки.</Typography.Text>;
  const canCreate = hasProjectPermission(access.data, 'broadcasts:create');
  return (
    <section>
      <Space className="page-heading" direction="vertical" size={0}>
        <Typography.Title level={2}>Рассылки</Typography.Title>
        <Typography.Text type="secondary">
          Telegram text broadcasts with a fixed recipient snapshot.
        </Typography.Text>
      </Space>
      {canCreate ? (
        <Button type="primary" onClick={() => navigate(`/projects/${projectId}/broadcasts/new`)}>
          Создать рассылку
        </Button>
      ) : null}
      {query.data?.length ? (
        <Table<Broadcast>
          rowKey="id"
          dataSource={query.data}
          pagination={false}
          onRow={(row) => ({
            onClick: () => navigate(`/projects/${projectId}/broadcasts/${row.id}`),
          })}
          columns={[
            { title: 'Название', dataIndex: 'name' },
            { title: 'Статус', dataIndex: 'status', render: (value) => <Tag>{value}</Tag> },
            { title: 'Получатели', dataIndex: 'recipientCount' },
            {
              title: 'Обновлено',
              dataIndex: 'updatedAt',
              render: (value) => new Date(value).toLocaleString(),
            },
          ]}
        />
      ) : (
        <Empty description="Рассылок пока нет" />
      )}
    </section>
  );
}
