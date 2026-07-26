import { Button, Form, Input, Result, Space, Spin, Typography, message } from 'antd';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import {
  emptyScenarioGraph,
  type ScenarioGraph,
  useScenario,
  useScenarioMutations,
} from '../automation-api';
import { hasProjectPermission, useProjectAccess } from '../project-access';

export function ScenarioEditorPage() {
  const { projectId, scenarioId } = useParams();
  const navigate = useNavigate();
  const access = useProjectAccess(projectId);
  const query = useScenario(projectId, scenarioId === 'new' ? undefined : scenarioId);
  const mutations = useScenarioMutations(projectId);
  const [graphText, setGraphText] = useState(() => JSON.stringify(emptyScenarioGraph, null, 2));
  if (scenarioId !== 'new' && query.isLoading) return <Spin />;
  if (!hasProjectPermission(access.data, 'automation:manage'))
    return (
      <Result
        status="403"
        title="Access denied"
        subTitle="Automation editing permission is required."
      />
    );
  const scenario = query.data;
  const submit = async (values: { description?: string; name: string }) => {
    let graph: ScenarioGraph;
    try {
      graph = JSON.parse(graphText) as ScenarioGraph;
    } catch {
      void message.error('Граф должен быть корректным JSON.');
      return;
    }
    try {
      if (scenario) await mutations.update.mutateAsync({ id: scenario.id, ...values, graph });
      else {
        const created = await mutations.create.mutateAsync({ ...values, graph });
        void navigate(`/projects/${projectId}/scenarios/${created.id}`);
      }
      void message.success('Черновик сохранён.');
    } catch {
      void message.error('Не удалось сохранить сценарий. Проверьте граф.');
    }
  };
  return (
    <section>
      <Typography.Title level={2}>{scenario ? scenario.name : 'Новый сценарий'}</Typography.Title>
      <Form initialValues={scenario ?? { name: '' }} layout="vertical" onFinish={submit}>
        <Form.Item label="Название" name="name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Описание" name="description">
          <Input.TextArea />
        </Form.Item>
        <Form.Item label="Граф сценария (JSON)">
          <Input.TextArea
            aria-label="Scenario graph"
            autoSize={{ minRows: 16 }}
            defaultValue={
              scenario?.draftVersion?.graph
                ? JSON.stringify(scenario.draftVersion.graph, null, 2)
                : graphText
            }
            onChange={(event) => setGraphText(event.target.value)}
          />
        </Form.Item>
        <Space>
          <Button
            htmlType="submit"
            loading={mutations.create.isPending || mutations.update.isPending}
            type="primary"
          >
            Сохранить черновик
          </Button>
          {scenario ? (
            <Button
              loading={mutations.publish.isPending}
              onClick={() => void mutations.publish.mutateAsync(scenario.id)}
            >
              Опубликовать
            </Button>
          ) : null}
        </Space>
      </Form>
    </section>
  );
}
