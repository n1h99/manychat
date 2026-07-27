import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { validateScenarioGraph } from '@omnicus/automation-core';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Result,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { AutomationNodeConfig } from '../automation-node-config';
import {
  type AutomationEdgeData,
  flowToScenarioGraph,
  scenarioGraphToFlow,
} from '../automation-editor-graph';
import {
  emptyScenarioGraph,
  type ScenarioExecution,
  useScenario,
  useScenarioExecutions,
  useScenarioMutations,
  useScenarios,
} from '../automation-api';
import { hasProjectPermission, useProjectAccess } from '../project-access';
import { useTemplates } from '../templates-api';

const palette = [
  ['INCOMING_MESSAGE', 'Incoming message'],
  ['CONDITION', 'Condition'],
  ['SEND_MESSAGE', 'Send message'],
  ['SEND_TEMPLATE', 'Send template'],
  ['ADD_TAG', 'Add tag'],
  ['REMOVE_TAG', 'Remove tag'],
  ['SET_CUSTOM_FIELD', 'Set custom field'],
  ['DELAY', 'Delay'],
  ['WAIT_FOR_REPLY', 'Wait for reply'],
  ['START_SUBFLOW', 'Subflow'],
  ['PAUSE_AUTOMATION', 'Pause automation'],
  ['RESUME_AUTOMATION', 'Resume automation'],
  ['STOP', 'Stop'],
] as const;

export function ScenarioEditorPage() {
  const { projectId, scenarioId } = useParams();
  const navigate = useNavigate();
  const access = useProjectAccess(projectId);
  const scenarioQuery = useScenario(projectId, scenarioId === 'new' ? undefined : scenarioId);
  const scenarios = useScenarios(projectId);
  const templates = useTemplates(projectId);
  const executions = useScenarioExecutions(projectId, scenarioId);
  const mutations = useScenarioMutations(projectId);
  const [form] = Form.useForm<{ description?: string; name: string }>();
  const initial = useMemo(() => scenarioGraphToFlow(emptyScenarioGraph), []);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [configs, setConfigs] = useState<Record<string, Record<string, unknown>>>({});
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [inspectedExecution, setInspectedExecution] = useState<ScenarioExecution>();

  useEffect(() => {
    const scenario = scenarioQuery.data;
    const graph = scenario?.draftVersion?.graph ?? scenario?.activeVersion?.graph;
    if (!graph || !scenario) return;
    const flow = scenarioGraphToFlow(graph);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setConfigs(Object.fromEntries(graph.nodes.map((node) => [node.id, node.config ?? {}])));
    form.setFieldsValue({
      ...(scenario.description ? { description: scenario.description } : {}),
      name: scenario.name,
    });
  }, [form, scenarioQuery.data, setEdges, setNodes]);

  if (scenarioId !== 'new' && scenarioQuery.isLoading) return <Spin />;
  if (!hasProjectPermission(access.data, 'automation:manage'))
    return (
      <Result
        status="403"
        title="Access denied"
        subTitle="Automation editing permission is required."
      />
    );

  const graph = flowToScenarioGraph(nodes, edges, configs);
  const validation = validateScenarioGraph(graph);
  const selected = nodes.find((node) => node.id === selectedId);
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId);

  const addNode = (type: string) => {
    const id = `${type.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
    setNodes((current) => [
      ...current,
      {
        data: { label: type },
        id,
        position: { x: 140 + current.length * 45, y: 120 + current.length * 35 },
        type: 'default',
      },
    ]);
    setConfigs((current) => ({
      ...current,
      [id]:
        type === 'DELAY'
          ? { delaySeconds: 60 }
          : type === 'WAIT_FOR_REPLY'
            ? { timeoutSeconds: 300 }
            : {},
    }));
  };

  const connect = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const source = nodes.find((node) => node.id === connection.source);
    const outgoing = edges.filter((edge) => edge.source === connection.source);
    const sourceType = String(source?.data.label);
    if (sourceType !== 'CONDITION' && sourceType !== 'WAIT_FOR_REPLY' && outgoing.length) {
      void message.warning('This output already has an active connection.');
      return;
    }
    const data: AutomationEdgeData =
      sourceType === 'CONDITION'
        ? {
            condition: { field: 'message.text', operator: 'exists' },
            output: `branch-${outgoing.length + 1}`,
            priority: outgoing.length,
          }
        : sourceType === 'WAIT_FOR_REPLY'
          ? { output: outgoing.length === 0 ? 'reply' : 'timeout' }
          : { output: 'default' };
    setEdges((current) =>
      addEdge(
        {
          ...connection,
          data,
          label: data.output === 'default' ? undefined : data.output,
        },
        current,
      ),
    );
  };

  const save = async (values: { description?: string; name: string }) => {
    if (validation.errors.length) {
      void message.error('Fix graph validation errors before saving.');
      return;
    }
    try {
      if (scenarioQuery.data)
        await mutations.update.mutateAsync({ id: scenarioQuery.data.id, ...values, graph });
      else {
        const created = await mutations.create.mutateAsync({ ...values, graph });
        void navigate(`/projects/${projectId}/scenarios/${created.id}`);
      }
      void message.success('Scenario draft saved.');
    } catch {
      void message.error('Scenario could not be saved.');
    }
  };

  return (
    <section>
      <Typography.Title level={2}>{scenarioQuery.data?.name ?? 'New scenario'}</Typography.Title>
      <Form form={form} initialValues={{ name: '' }} layout="vertical" onFinish={save}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="Name" name="name" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="Description" name="description">
              <Input />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={5}>
            <Card size="small" title="Node palette">
              <Space direction="vertical" style={{ width: '100%' }}>
                {palette.map(([type, label]) => (
                  <Button block key={type} onClick={() => addNode(type)}>
                    {label}
                  </Button>
                ))}
              </Space>
            </Card>
          </Col>
          <Col span={14}>
            <div aria-label="Scenario canvas" style={{ border: '1px solid #d9d9d9', height: 560 }}>
              <ReactFlow
                edges={edges}
                fitView
                nodes={nodes}
                onConnect={connect}
                onEdgeClick={(_, edge) => {
                  setSelectedEdgeId(edge.id);
                  setSelectedId(undefined);
                }}
                onEdgesChange={onEdgesChange}
                onNodeClick={(_, node) => {
                  setSelectedId(node.id);
                  setSelectedEdgeId(undefined);
                }}
                onNodesChange={onNodesChange}
              >
                <Background />
                <Controls />
                <MiniMap />
              </ReactFlow>
            </div>
          </Col>
          <Col span={5}>
            <Card size="small" title={selected ? 'Node settings' : 'Edge settings'}>
              {selected ? (
                <>
                  <Tag>{String(selected.data.label)}</Tag>
                  <AutomationNodeConfig
                    config={configs[selected.id] ?? {}}
                    nodeType={String(selected.data.label)}
                    onChange={(config) =>
                      setConfigs((current) => ({ ...current, [selected.id]: config }))
                    }
                    scenarios={scenarios.data ?? []}
                    templates={templates.data ?? []}
                  />
                  {String(selected.data.label) !== 'INCOMING_MESSAGE' ? (
                    <Button
                      danger
                      onClick={() => {
                        setNodes((current) => current.filter((node) => node.id !== selected.id));
                        setEdges((current) =>
                          current.filter(
                            (edge) => edge.source !== selected.id && edge.target !== selected.id,
                          ),
                        );
                        setSelectedId(undefined);
                      }}
                    >
                      Delete node
                    </Button>
                  ) : null}
                </>
              ) : selectedEdge ? (
                <EdgeConfiguration
                  edge={selectedEdge}
                  onChange={(next) =>
                    setEdges((current) =>
                      current.map((edge) => (edge.id === next.id ? next : edge)),
                    )
                  }
                />
              ) : (
                <Typography.Text type="secondary">Select a node or edge.</Typography.Text>
              )}
            </Card>
          </Col>
        </Row>
        <Space style={{ marginTop: 16 }}>
          <Button
            htmlType="submit"
            loading={mutations.create.isPending || mutations.update.isPending}
            type="primary"
          >
            Save draft
          </Button>
          {scenarioQuery.data ? (
            <Button
              disabled={validation.errors.length > 0}
              loading={mutations.publish.isPending}
              onClick={() => void mutations.publish.mutateAsync(scenarioQuery.data!.id)}
            >
              Publish
            </Button>
          ) : null}
        </Space>
      </Form>
      <Space direction="vertical" style={{ marginTop: 16, width: '100%' }}>
        {validation.errors.length ? (
          <Alert
            description={validation.errors.map((error) => (
              <div key={error}>{error}</div>
            ))}
            message="Graph cannot be published"
            showIcon
            type="error"
          />
        ) : (
          <Alert message="Graph validation passed" showIcon type="success" />
        )}
        {validation.warnings.length ? (
          <Alert description={validation.warnings.join('; ')} message="Warnings" type="warning" />
        ) : null}
      </Space>
      {scenarioQuery.data ? (
        <>
          <Typography.Title level={4}>Version history</Typography.Title>
          <Table
            columns={[
              { dataIndex: 'version', title: 'Version' },
              { dataIndex: 'status', title: 'Status', render: (value) => <Tag>{value}</Tag> },
              {
                dataIndex: 'publishedAt',
                title: 'Published',
                render: (value) => (value ? new Date(value).toLocaleString() : '—'),
              },
              {
                key: 'restore',
                render: (_, version) => (
                  <Button
                    onClick={() =>
                      void mutations.restoreVersion.mutateAsync({
                        scenarioId: scenarioQuery.data!.id,
                        versionId: version.id,
                      })
                    }
                    size="small"
                  >
                    Restore to draft
                  </Button>
                ),
              },
            ]}
            dataSource={scenarioQuery.data.versions ?? []}
            pagination={false}
            rowKey="id"
          />
          <Typography.Title level={4}>Execution inspector</Typography.Title>
          <Table
            columns={[
              {
                dataIndex: 'createdAt',
                render: (value) => new Date(value).toLocaleString(),
                title: 'Started',
              },
              { dataIndex: 'status', title: 'Status', render: (value) => <Tag>{value}</Tag> },
              {
                dataIndex: 'currentNodeId',
                title: 'Current node',
                render: (value) => value ?? '—',
              },
            ]}
            dataSource={executions.data ?? []}
            loading={executions.isLoading}
            onRow={(record) => ({ onClick: () => setInspectedExecution(record) })}
            pagination={false}
            rowKey="id"
          />
        </>
      ) : null}
      <Drawer
        onClose={() => setInspectedExecution(undefined)}
        open={Boolean(inspectedExecution)}
        title="Execution details"
        width={520}
      >
        {inspectedExecution ? (
          <>
            <Descriptions
              column={1}
              items={[
                { children: inspectedExecution.id, key: 'id', label: 'Execution' },
                { children: inspectedExecution.status, key: 'status', label: 'Status' },
                {
                  children: inspectedExecution.currentNodeId ?? '—',
                  key: 'current',
                  label: 'Current node',
                },
              ]}
            />
            <Timeline
              items={inspectedExecution.nodeExecutions.map((node) => ({
                children: (
                  <Space direction="vertical" size={0}>
                    <Typography.Text strong>{node.nodeId}</Typography.Text>
                    <Typography.Text type="secondary">
                      {node.nodeType} · {node.status} · attempt {node.attempt}
                    </Typography.Text>
                  </Space>
                ),
                color:
                  node.status === 'SUCCEEDED' ? 'green' : node.status === 'FAILED' ? 'red' : 'blue',
              }))}
            />
          </>
        ) : null}
      </Drawer>
    </section>
  );
}

function EdgeConfiguration({ edge, onChange }: { edge: Edge; onChange(edge: Edge): void }) {
  const data = (edge.data ?? {}) as AutomationEdgeData;
  const update = (next: Partial<AutomationEdgeData>) => {
    const merged = { ...data, ...next };
    onChange({
      ...edge,
      data: merged,
      label: merged.output === 'default' ? undefined : merged.output,
    });
  };
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Form.Item label="Output port">
        <Input onChange={(event) => update({ output: event.target.value })} value={data.output} />
      </Form.Item>
      {data.priority !== undefined ? (
        <>
          <Form.Item label="Branch priority">
            <InputNumber
              min={0}
              onChange={(value) => update({ priority: value ?? 0 })}
              value={data.priority}
            />
          </Form.Item>
          <Form.Item label="Field">
            <Input
              onChange={(event) =>
                update({
                  condition: {
                    field: event.target.value,
                    operator: data.condition?.operator ?? 'exists',
                    value: data.condition?.value,
                  },
                })
              }
              value={data.condition?.field}
            />
          </Form.Item>
          <Form.Item label="Operator">
            <Select
              onChange={(operator) =>
                update({
                  condition: {
                    field: data.condition?.field ?? 'message.text',
                    operator: operator ?? 'exists',
                    value: data.condition?.value,
                  },
                })
              }
              options={['equals', 'not_equals', 'contains', 'exists', 'not_exists'].map(
                (value) => ({ label: value, value }),
              )}
              value={data.condition?.operator}
            />
          </Form.Item>
          <Form.Item label="Value">
            <Input
              onChange={(event) =>
                update({
                  condition: {
                    field: data.condition?.field ?? 'message.text',
                    operator: data.condition?.operator ?? 'equals',
                    value: event.target.value,
                  },
                })
              }
              value={typeof data.condition?.value === 'string' ? data.condition.value : undefined}
            />
          </Form.Item>
        </>
      ) : null}
    </Space>
  );
}
