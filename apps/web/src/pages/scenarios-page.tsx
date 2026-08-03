import { DeleteOutlined, PauseOutlined, PlayCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Modal, Space, Spin, Table, Typography, message } from 'antd';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { getUserErrorMessage } from '../api';
import { type ScenarioSummary, useScenarioMutations, useScenarios } from '../automation-api';
import { hasProjectPermission, useProjectAccess } from '../project-access';
import { StatusText } from '../status-text';

export function ScenariosPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const scenarios = useScenarios(projectId);
  const access = useProjectAccess(projectId);
  const mutations = useScenarioMutations(projectId);
  const [removing, setRemoving] = useState<ScenarioSummary>();
  const canManage = hasProjectPermission(access.data, 'automation:manage');
  const action = async (operation: () => Promise<unknown>, success: string, fallback: string) => {
    try {
      await operation();
      void message.success(success);
      return true;
    } catch (error) {
      void message.error(getUserErrorMessage(error, fallback));
      return false;
    }
  };

  if (scenarios.isLoading) return <Spin className="route-loading" />;

  return (
    <section>
      <div className="page-heading-row">
        <div>
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
          { dataIndex: 'name', title: 'Name', width: '42%' },
          {
            dataIndex: 'status',
            render: (status) => <StatusText status={status} />,
            title: 'Status',
            width: 150,
          },
          {
            dataIndex: 'updatedAt',
            render: (value) => new Date(value).toLocaleString(),
            title: 'Updated',
            width: 210,
          },
          ...(canManage
            ? [
                {
                  key: 'actions',
                  render: (_: unknown, scenario: ScenarioSummary) => (
                    <Space
                      className="stable-table-actions"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {scenario.status === 'PUBLISHED' ? (
                        <Button
                          icon={<PauseOutlined />}
                          onClick={() =>
                            void action(
                              () => mutations.pause.mutateAsync(scenario.id),
                              'Automation deactivated.',
                              'Automation could not be deactivated.',
                            )
                          }
                          size="small"
                          className="scenario-state-action"
                        >
                          Deactivate
                        </Button>
                      ) : scenario.status === 'PAUSED' ? (
                        <Button
                          icon={<PlayCircleOutlined />}
                          onClick={() =>
                            void action(
                              () => mutations.resume.mutateAsync(scenario.id),
                              'Automation resumed.',
                              'Automation could not be resumed.',
                            )
                          }
                          size="small"
                          className="scenario-state-action"
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
                  width: 250,
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
        centered
        okButtonProps={{ danger: true, loading: mutations.remove.isPending }}
        okText="Delete automation"
        onCancel={() => setRemoving(undefined)}
        onOk={async () => {
          if (!removing) return;
          const succeeded = await action(
            () => mutations.remove.mutateAsync(removing.id),
            'Automation deleted.',
            'Automation could not be deleted.',
          );
          if (!succeeded) return;
          setRemoving(undefined);
        }}
        open={Boolean(removing)}
        title="Delete this automation?"
      >
        The automation will be deleted and removed from this list. Its version and execution history will
        remain available for audit.
      </Modal>
    </section>
  );
}
