import { Button, Empty, Space, Spin, Table, Tag, Typography } from 'antd';
import { useNavigate, useParams } from 'react-router';

import { type ScenarioSummary, useScenarios } from '../automation-api';
import { hasProjectPermission, useProjectAccess } from '../project-access';

export function ScenariosPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const scenarios = useScenarios(projectId);
  const access = useProjectAccess(projectId);
  if (scenarios.isLoading) return <Spin />;
  if (scenarios.isError)
    return <Typography.Text type="danger">Не удалось загрузить сценарии.</Typography.Text>;
  return (
    <section>
      <Space className="page-heading" direction="vertical" size={0}>
        <Typography.Title level={2}>Автоматизация</Typography.Title>
        <Typography.Text type="secondary">
          Детерминированные сценарии текущего проекта.
        </Typography.Text>
      </Space>
      {hasProjectPermission(access.data, 'automation:manage') ? (
        <Button type="primary" onClick={() => navigate(`/projects/${projectId}/scenarios/new`)}>
          Создать сценарий
        </Button>
      ) : null}
      {scenarios.data?.length ? (
        <Table<ScenarioSummary>
          columns={[
            { dataIndex: 'name', title: 'Название' },
            { dataIndex: 'status', render: (status) => <Tag>{status}</Tag>, title: 'Статус' },
            {
              dataIndex: 'updatedAt',
              render: (value) => new Date(value).toLocaleString(),
              title: 'Обновлён',
            },
          ]}
          dataSource={scenarios.data}
          onRow={(row) => ({
            onClick: () => navigate(`/projects/${projectId}/scenarios/${row.id}`),
          })}
          pagination={false}
          rowKey="id"
        />
      ) : (
        <Empty description="Сценариев ещё нет" />
      )}
    </section>
  );
}
