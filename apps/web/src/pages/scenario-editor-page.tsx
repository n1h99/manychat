import {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { validateScenarioGraph } from '@omnicus/automation-core';
import {
  ApiOutlined,
  BranchesOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  SendOutlined,
  SettingOutlined,
  StopOutlined,
  TagsOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
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
  automationEdgeLabel,
  type AutomationEdgeData,
  flowToScenarioGraph,
  scenarioGraphToFlow,
  spreadCompactFlowNodes,
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

const paletteGroups = [
  {
    key: 'triggers',
    label: 'Triggers',
    nodes: [['INCOMING_MESSAGE', 'Incoming message']],
  },
  {
    key: 'logic',
    label: 'Logic',
    nodes: [
      ['CONDITION', 'Condition'],
      ['DELAY', 'Delay'],
      ['WAIT_FOR_REPLY', 'Wait for reply'],
      ['START_SUBFLOW', 'Subflow'],
      ['STOP', 'Stop'],
    ],
  },
  {
    key: 'messaging',
    label: 'Messaging',
    nodes: [
      ['SEND_MESSAGE', 'Send message'],
      ['SEND_TEMPLATE', 'Send template'],
      ['FORWARD_TO_CRM', 'Forward to CRM'],
    ],
  },
  {
    key: 'data',
    label: 'Data & control',
    nodes: [
      ['CREATE_OR_UPDATE_LEAD', 'Create/update lead'],
      ['ADD_TAG', 'Add tag'],
      ['REMOVE_TAG', 'Remove tag'],
      ['SET_CUSTOM_FIELD', 'Set custom field'],
      ['PAUSE_AUTOMATION', 'Pause automation'],
      ['RESUME_AUTOMATION', 'Resume automation'],
    ],
  },
] as const;

const paletteLabels = new Map<string, string>(
  paletteGroups.flatMap((group) =>
    group.nodes.map(([type, label]) => [type, label] as [string, string]),
  ),
);

type AutomationCanvasNodeDefinition = Node<{ label: string }, 'automation'>;

function automationNodeIcon(type: string) {
  if (type === 'INCOMING_MESSAGE') return <ThunderboltOutlined />;
  if (type === 'CONDITION') return <BranchesOutlined />;
  if (type === 'SEND_MESSAGE' || type === 'SEND_TEMPLATE') return <SendOutlined />;
  if (type === 'FORWARD_TO_CRM') return <ApiOutlined />;
  if (type === 'CREATE_OR_UPDATE_LEAD' || type === 'SET_CUSTOM_FIELD') return <DatabaseOutlined />;
  if (type === 'ADD_TAG' || type === 'REMOVE_TAG') return <TagsOutlined />;
  if (type === 'DELAY' || type === 'WAIT_FOR_REPLY') return <ClockCircleOutlined />;
  if (type === 'PAUSE_AUTOMATION') return <PauseCircleOutlined />;
  if (type === 'RESUME_AUTOMATION') return <PlayCircleOutlined />;
  if (type === 'STOP') return <StopOutlined />;
  if (type === 'START_SUBFLOW') return <BranchesOutlined />;
  return <SettingOutlined />;
}

function automationNodeCategory(type: string) {
  if (type === 'INCOMING_MESSAGE') return 'Trigger';
  if (['CONDITION', 'DELAY', 'WAIT_FOR_REPLY', 'START_SUBFLOW'].includes(type)) return 'Logic';
  if (type === 'STOP') return 'End';
  return 'Action';
}

function AutomationCanvasNode({ data, selected }: NodeProps<AutomationCanvasNodeDefinition>) {
  const type = String(data.label);
  return (
    <div
      className={`automation-flow-node automation-flow-node--${automationNodeCategory(type).toLowerCase()}${selected ? ' is-selected' : ''}`}
    >
      <Handle className="automation-node-handle" position={Position.Top} type="target" />
      <span className="automation-flow-node-icon">{automationNodeIcon(type)}</span>
      <span className="automation-flow-node-copy">
        <small>{automationNodeCategory(type)}</small>
        <strong>{paletteLabels.get(type) ?? type}</strong>
      </span>
      <Handle className="automation-node-handle" position={Position.Bottom} type="source" />
    </div>
  );
}

const automationNodeTypes: NodeTypes = { automation: AutomationCanvasNode };
const automationEdgeDefaults: Partial<Edge> = {
  labelBgBorderRadius: 8,
  labelBgPadding: [7, 4],
  labelBgStyle: { fill: '#ffffff', fillOpacity: 0.96 },
  labelStyle: { fill: '#475569', fontSize: 10, fontWeight: 600 },
  style: { stroke: '#94a3b8', strokeWidth: 2 },
  type: 'smoothstep',
};

async function fitDefaultAutomationViewport(instance: ReactFlowInstance) {
  await instance.fitView({ padding: 0.24 });
  await instance.zoomOut({ duration: 0 });
  await instance.zoomOut({ duration: 0 });
}

function styledNodes(nodes: Node[]): Node[] {
  return spreadCompactFlowNodes(nodes).map((node) => ({ ...node, type: 'automation' }));
}

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
  const initial = useMemo(() => {
    const flow = scenarioGraphToFlow(emptyScenarioGraph);
    return { ...flow, nodes: styledNodes(flow.nodes) };
  }, []);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [configs, setConfigs] = useState<Record<string, Record<string, unknown>>>({});
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [inspectedExecution, setInspectedExecution] = useState<ScenarioExecution>();
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance>();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCanvasInteractive, setIsCanvasInteractive] = useState(true);
  const scenarioName = Form.useWatch('name', form);
  const scenarioDescription = Form.useWatch('description', form);

  useEffect(() => {
    const scenario = scenarioQuery.data;
    const graph = scenario?.draftVersion?.graph ?? scenario?.activeVersion?.graph;
    if (!graph || !scenario) return;
    const flow = scenarioGraphToFlow(graph);
    setNodes(styledNodes(flow.nodes));
    setEdges(flow.edges);
    setConfigs(Object.fromEntries(graph.nodes.map((node) => [node.id, node.config ?? {}])));
    form.setFieldsValue({
      ...(scenario.description ? { description: scenario.description } : {}),
      name: scenario.name,
    });
  }, [form, scenarioQuery.data, setEdges, setNodes]);

  useEffect(() => {
    if (!isFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', exitOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', exitOnEscape);
    };
  }, [isFullscreen]);

  useEffect(() => {
    if (!flowInstance) return;
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        void fitDefaultAutomationViewport(flowInstance);
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [flowInstance, isFullscreen]);

  if (scenarioId !== 'new' && scenarioQuery.isLoading)
    return <Spin className="route-loading" size="large" />;
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
        position: {
          x: 140,
          y: current.reduce((maximum, node) => Math.max(maximum, node.position.y), 0) + 140,
        },
        type: 'automation',
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
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        void flowInstance?.fitView({ duration: 240, padding: 0.24 });
      });
    });
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
          label: automationEdgeLabel(data.output),
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
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>
            {scenarioQuery.data?.name ?? 'New scenario'}
          </Typography.Title>
          <Typography.Text type="secondary">
            Design, validate and publish a deterministic customer journey.
          </Typography.Text>
        </div>
      </div>
      <Form
        className={`automation-editor${isFullscreen ? ' is-fullscreen' : ''}`}
        form={form}
        initialValues={{ name: '' }}
        layout="vertical"
        onFinish={save}
      >
        <div className="automation-fullscreen-toolbar">
          <div className="automation-fullscreen-title">
            <strong>{scenarioName || scenarioQuery.data?.name || 'New scenario'}</strong>
            {scenarioDescription ? <small>{scenarioDescription}</small> : null}
          </div>
          <Space wrap>
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
            <Button
              aria-label="Exit full screen"
              icon={<FullscreenExitOutlined />}
              onClick={() => setIsFullscreen(false)}
            >
              Exit full screen
            </Button>
          </Space>
        </div>
        <Row className="automation-editor-fields" gutter={16}>
          <Col lg={10} xs={24}>
            <Form.Item label="Name" name="name" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col lg={10} xs={24}>
            <Form.Item label="Description" name="description">
              <Input />
            </Form.Item>
          </Col>
          <Col className="automation-fullscreen-trigger" lg={4} xs={24}>
            <Button
              aria-label="Enter full screen"
              block
              icon={<FullscreenOutlined />}
              onClick={() => setIsFullscreen(true)}
            >
              Full screen
            </Button>
          </Col>
        </Row>
        <Row className="automation-workspace" gutter={[16, 16]}>
          <Col lg={6} xl={5} xs={24}>
            <Card className="automation-panel-card" size="small" title="Add a step">
              <Typography.Paragraph className="automation-panel-hint" type="secondary">
                Choose a step and place it on the canvas.
              </Typography.Paragraph>
              <Collapse
                className="node-palette"
                defaultActiveKey={['triggers', 'logic']}
                ghost
                items={paletteGroups.map((group) => ({
                  children: (
                    <div className="node-palette-items">
                      {group.nodes.map(([type, label]) => (
                        <Button
                          block
                          className="node-palette-item"
                          icon={automationNodeIcon(type)}
                          key={type}
                          onClick={() => addNode(type)}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  ),
                  key: group.key,
                  label: group.label,
                }))}
              />
            </Card>
          </Col>
          <Col lg={18} xl={14} xs={24}>
            <div aria-label="Scenario canvas" className="scenario-canvas">
              <ReactFlow
                connectionLineStyle={{ stroke: '#0f766e', strokeWidth: 2 }}
                defaultEdgeOptions={automationEdgeDefaults}
                edges={edges}
                fitView
                fitViewOptions={{ padding: 0.24 }}
                maxZoom={1.6}
                minZoom={0.35}
                nodeTypes={automationNodeTypes}
                nodes={nodes}
                nodesConnectable={isCanvasInteractive}
                nodesDraggable={isCanvasInteractive}
                elementsSelectable={isCanvasInteractive}
                panOnDrag={isCanvasInteractive}
                zoomOnDoubleClick={isCanvasInteractive}
                zoomOnPinch={isCanvasInteractive}
                zoomOnScroll={isCanvasInteractive}
                onInit={(instance) => {
                  setFlowInstance(instance);
                }}
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
                proOptions={{ hideAttribution: true }}
              >
                <Background color="#dbe5ef" gap={22} size={1.2} />
                <Controls
                  className="automation-flow-controls"
                  onInteractiveChange={setIsCanvasInteractive}
                  showFitView={isCanvasInteractive}
                  showZoom={isCanvasInteractive}
                />
                <MiniMap
                  className="automation-flow-minimap"
                  maskColor="rgba(241, 245, 249, 0.78)"
                  nodeColor="#99c9c4"
                  style={{ height: 75, width: 100 }}
                />
              </ReactFlow>
            </div>
          </Col>
          <Col lg={24} xl={5} xs={24}>
            <Card
              className="automation-panel-card"
              size="small"
              title={selected ? 'Node settings' : selectedEdge ? 'Connection settings' : 'Settings'}
            >
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
                <div className="automation-settings-empty">
                  <SettingOutlined />
                  <strong>Nothing selected</strong>
                  <Typography.Text type="secondary">
                    Select a step or connection on the canvas to configure it.
                  </Typography.Text>
                </div>
              )}
            </Card>
          </Col>
        </Row>
        <Space className="automation-actions" wrap>
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
      <Space className="automation-validation" direction="vertical">
        {validation.errors.length ? (
          <Alert
            className="soft-notice"
            description={validation.errors.map((error) => (
              <div key={error}>{error}</div>
            ))}
            message="Graph cannot be published"
            showIcon
            type="error"
          />
        ) : (
          <Alert
            className="soft-notice"
            message="Graph validation passed"
            showIcon
            type="success"
          />
        )}
        {validation.warnings.length ? (
          <Alert
            className="soft-notice"
            description={validation.warnings.join('; ')}
            message="Warnings"
            showIcon
            type="warning"
          />
        ) : null}
      </Space>
      {scenarioQuery.data ? (
        <>
          <Typography.Title className="automation-section-title" level={4}>
            Version history
          </Typography.Title>
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
          <Typography.Title className="automation-section-title" level={4}>
            Execution inspector
          </Typography.Title>
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
