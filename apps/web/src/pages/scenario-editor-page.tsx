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
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  Result,
  Row,
  Space,
  Spin,
  Table,
  Typography,
  message,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import {
  emptyScenarioGraph,
  type ScenarioGraph,
  useScenario,
  useScenarioExecutions,
  useScenarioMutations,
} from '../automation-api';
import { hasProjectPermission, useProjectAccess } from '../project-access';

const palette = [
  ['INCOMING_MESSAGE', 'Incoming Message'],
  ['CONDITION', 'Condition'],
  ['SEND_MESSAGE', 'Send Message'],
  ['ADD_TAG', 'Add Tag'],
  ['REMOVE_TAG', 'Remove Tag'],
  ['SET_CUSTOM_FIELD', 'Set Custom Field'],
  ['DELAY', 'Delay'],
  ['WAIT_FOR_REPLY', 'Wait for Reply'],
  ['START_SUBFLOW', 'Subflow'],
  ['PAUSE_AUTOMATION', 'Pause Automation'],
  ['RESUME_AUTOMATION', 'Resume Automation'],
  ['STOP', 'Stop'],
] as const;

function toFlow(graph: ScenarioGraph): { edges: Edge[]; nodes: Node[] } {
  return {
    edges: graph.edges.map((edge, index) => ({
      id: edge.id ?? `edge-${index}-${edge.from}-${edge.to}`,
      label: edge.output && edge.output !== 'default' ? edge.output : undefined,
      source: edge.from,
      target: edge.to,
    })),
    nodes: graph.nodes.map((node) => ({
      data: { label: node.type },
      id: node.id,
      position: node.position ?? { x: 0, y: 0 },
      type: 'default',
    })),
  };
}

function toGraph(
  nodes: Node[],
  edges: Edge[],
  configs: Record<string, Record<string, unknown>>,
): ScenarioGraph {
  return {
    edges: edges.map((edge) => ({
      from: edge.source,
      id: edge.id,
      output: typeof edge.label === 'string' ? edge.label : 'default',
      to: edge.target,
    })),
    nodes: nodes.map((node) => ({
      config: configs[node.id] ?? {},
      id: node.id,
      position: node.position,
      type: String(node.data.label),
    })),
  };
}

export function ScenarioEditorPage() {
  const { projectId, scenarioId } = useParams();
  const navigate = useNavigate();
  const access = useProjectAccess(projectId);
  const scenarioQuery = useScenario(projectId, scenarioId === 'new' ? undefined : scenarioId);
  const executions = useScenarioExecutions(projectId, scenarioId);
  const mutations = useScenarioMutations(projectId);
  const [form] = Form.useForm<{ description?: string; name: string }>();
  const initial = useMemo(() => toFlow(emptyScenarioGraph), []);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [configs, setConfigs] = useState<Record<string, Record<string, unknown>>>({});
  const [selectedId, setSelectedId] = useState<string>();

  useEffect(() => {
    const scenario = scenarioQuery.data;
    const graph = scenario?.draftVersion?.graph;
    if (!graph || !scenario) return;
    const flow = toFlow(graph);
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
  const selected = nodes.find((node) => node.id === selectedId);
  const selectedConfig = selected ? (configs[selected.id] ?? {}) : {};
  const addNode = (type: string) => {
    const id = `${type.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
    setNodes((current) => [
      ...current,
      {
        data: { label: type },
        id,
        position: { x: 140 + current.length * 40, y: 140 + current.length * 30 },
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
    setEdges((current) => addEdge({ ...connection, label: 'default' }, current));
  };
  const save = async (values: { description?: string; name: string }) => {
    const graph = toGraph(nodes, edges, configs);
    try {
      if (scenarioQuery.data)
        await mutations.update.mutateAsync({ id: scenarioQuery.data.id, ...values, graph });
      else {
        const created = await mutations.create.mutateAsync({ ...values, graph });
        void navigate(`/projects/${projectId}/scenarios/${created.id}`);
      }
      void message.success('Черновик сохранён.');
    } catch {
      void message.error('Не удалось сохранить сценарий. Проверьте настройки узлов.');
    }
  };
  return (
    <section>
      <Typography.Title level={2}>{scenarioQuery.data?.name ?? 'Новый сценарий'}</Typography.Title>
      <Form form={form} initialValues={{ name: '' }} layout="vertical" onFinish={save}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="Название" name="name" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="Описание" name="description">
              <Input />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={5}>
            <Card size="small" title="Узлы">
              <Space direction="vertical" style={{ width: '100%' }}>
                {palette.map(([type, label]) => (
                  <Button key={type} onClick={() => addNode(type)}>
                    {label}
                  </Button>
                ))}
              </Space>
            </Card>
          </Col>
          <Col span={14}>
            <div aria-label="Scenario canvas" style={{ border: '1px solid #d9d9d9', height: 520 }}>
              <ReactFlow
                edges={edges}
                fitView
                nodes={nodes}
                onConnect={connect}
                onEdgesChange={onEdgesChange}
                onNodeClick={(_, node) => setSelectedId(node.id)}
                onNodesChange={onNodesChange}
              >
                <Background />
                <Controls />
                <MiniMap />
              </ReactFlow>
            </div>
          </Col>
          <Col span={5}>
            <Card size="small" title="Настройки узла">
              {selected ? (
                <>
                  <Typography.Text>{String(selected.data.label)}</Typography.Text>
                  <Input.TextArea
                    aria-label="Node configuration JSON"
                    autoSize={{ minRows: 10 }}
                    value={JSON.stringify(selectedConfig, null, 2)}
                    onChange={(event) => {
                      try {
                        const config = JSON.parse(event.target.value) as Record<string, unknown>;
                        setConfigs((current) => ({ ...current, [selected.id]: config }));
                      } catch {
                        /* incomplete JSON stays uncommitted */
                      }
                    }}
                  />
                </>
              ) : (
                'Выберите узел на canvas.'
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
            Сохранить черновик
          </Button>
          {scenarioQuery.data ? (
            <Button
              loading={mutations.publish.isPending}
              onClick={() => void mutations.publish.mutateAsync(scenarioQuery.data!.id)}
            >
              Опубликовать
            </Button>
          ) : null}
        </Space>
      </Form>
      {scenarioQuery.data ? (
        <section className="section-actions">
          <Typography.Title level={4}>Execution journal</Typography.Title>
          <Table
            columns={[
              {
                dataIndex: 'createdAt',
                render: (value) => new Date(value).toLocaleString(),
                title: 'Started',
              },
              { dataIndex: 'status', title: 'Status' },
              {
                dataIndex: 'nodeExecutions',
                render: (items: Array<{ nodeId: string; status: string }>) =>
                  items.map((item) => `${item.nodeId}: ${item.status}`).join(', ') || '—',
                title: 'Nodes',
              },
            ]}
            dataSource={executions.data ?? []}
            loading={executions.isLoading}
            pagination={false}
            rowKey="id"
          />
        </section>
      ) : null}
    </section>
  );
}
