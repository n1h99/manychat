import { DeleteOutlined, PauseOutlined, PlayCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Modal, Space, Spin, Table, Tag, Typography, message } from 'antd';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { type ScenarioSummary, useScenarioMutations, useScenarios } from '../automation-api';
import { hasProjectPermission, useProjectAccess } from '../project-access';

export function ScenariosPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const scenarios = useScenarios(projectId);
  const access = useProjectAccess(projectId);
  const mutations = useScenarioMutations(projectId);
  const [removing, setRemoving] = useState<ScenarioSummary>();
  const canManage = hasProjectPermission(access.data, 'automation:manage');

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
          ...(canManage
            ? [
                {
                  key: 'actions',
                  render: (_: unknown, scenario: ScenarioSummary) => (
                    <Space onClick={(event) => event.stopPropagation()}>
                      {scenario.status === 'PUBLISHED' ? (
                        <Button
                          icon={<PauseOutlined />}
                          onClick={() => void mutations.pause.mutateAsync(scenario.id)}
                          size="small"
                        >
                          Deactivate
                        </Button>
                      ) : scenario.status === 'PAUSED' ? (
                        <Button
                          icon={<PlayCircleOutlined />}
                          onClick={() => void mutations.resume.mutateAsync(scenario.id)}
                          size="small"
                        >
                          Resume
                        </Button>
                      ) : null}
                      <Button
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => setRemoving(scenario)}
                        size="small"
                      >
                        Delete
                      </Button>
                    </Space>
                  ),
                  title: 'Actions',
                },
              ]
            : []),
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
      <Modal
        cancelText="Keep automation"
        okButtonProps={{ danger: true, loading: mutations.remove.isPending }}
        okText="Delete automation"
        onCancel={() => setRemoving(undefined)}
        onOk={async () => {
          if (!removing) return;
          await mutations.remove.mutateAsync(removing.id);
          setRemoving(undefined);
          void message.success('Automation deleted.');
        }}
        open={Boolean(removing)}
        title="Delete this automation?"
      >
        The automation will be archived and removed from this list. Its version and execution
        history will remain available for audit.
      </Modal>
    </section>
  );
}
