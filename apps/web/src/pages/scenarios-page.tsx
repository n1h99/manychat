import { PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Spin, Table, Tag, Typography } from 'antd';
import { useNavigate, useParams } from 'react-router';

import { type ScenarioSummary, useScenarios } from '../automation-api';
import { hasProjectPermission, useProjectAccess } from '../project-access';

export function ScenariosPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const scenarios = useScenarios(projectId);
  const access = useProjectAccess(projectId);

  if (scenarios.isLoading) return <Spin className="route-loading" />;

  return (
    <section>
      <div className="page-heading-row">
        <div>
          <Typography.Text className="header-kicker">Automation</Typography.Text>
          <Typography.Title level={2}>Scenarios</Typography.Title>
          <Typography.Text type="secondary">
            Build and manage deterministic customer journeys for this project.
          </Typography.Text>
        </div>
        {hasProjectPermission(access.data, 'automation:manage') ? (
          <Button
            icon={<PlusOutlined />}
            onClick={() => navigate(`/projects/${projectId}/scenarios/new`)}
            type="primary"
          >
            Create scenario
          </Button>
        ) : null}
      </div>
      {scenarios.isError ? (
        <Alert
          className="form-alert"
          message="Scenarios could not be loaded. Try again shortly."
          showIcon
          type="error"
        />
      ) : null}
      <Table<ScenarioSummary>
        columns={[
          { dataIndex: 'name', title: 'Name' },
          { dataIndex: 'status', render: (status) => <Tag>{status}</Tag>, title: 'Status' },
          {
            dataIndex: 'updatedAt',
            render: (value) => new Date(value).toLocaleString(),
            title: 'Updated',
          },
        ]}
        dataSource={scenarios.data ?? []}
        locale={{
          emptyText: (
            <Empty description="No scenarios created" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ),
        }}
        onRow={(row) => ({
          onClick: () => navigate(`/projects/${projectId}/scenarios/${row.id}`),
        })}
        pagination={false}
        rowClassName="clickable-row"
        rowKey="id"
      />
    </section>
  );
}
