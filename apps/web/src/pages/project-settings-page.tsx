import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import { CopyOutlined, SaveOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { apiRequest, getUserErrorMessage } from '../api';
import { useAuth } from '../auth';
import type { Project } from './projects-page';

export function ProjectSettingsPage() {
  const { projectId } = useParams();
  const { accessToken, identity } = useAuth();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [cloneOpen, setCloneOpen] = useState(false);
  const [form] = Form.useForm();
  const [cloneForm] = Form.useForm();
  const canClone = identity?.globalPermissions.includes('projects:create') ?? false;
  const project = useQuery({
    enabled: Boolean(projectId),
    queryFn: () => apiRequest<Project>(`/api/v1/projects/${projectId}`, {}, accessToken),
    queryKey: ['project', projectId, accessToken],
  });
  if (project.isError)
    return (
      <Alert
        message={getUserErrorMessage(project.error, 'Project settings could not be loaded.')}
        showIcon
        type="error"
      />
    );
  const data = project.data;
  return (
    <section className="project-settings-page">
      <div className="page-heading-row">
        <div>
          <Typography.Title level={2}>Project settings</Typography.Title>
          <Typography.Text type="secondary">
            Workspace identity, locale and safe project cloning.
          </Typography.Text>
        </div>
        {data ? (
          <Tag color={data.status === 'ACTIVE' ? 'green' : 'orange'}>{data.status}</Tag>
        ) : null}
      </div>
      <Card className="settings-card" title="General">
        {data ? (
          <Form
            form={form}
            initialValues={data}
            layout="vertical"
            onFinish={async (values) => {
              try {
                await apiRequest(
                  `/api/v1/projects/${projectId}`,
                  { body: JSON.stringify(values), method: 'PATCH' },
                  accessToken,
                );
                await client.invalidateQueries({ queryKey: ['project', projectId] });
                void message.success('Project settings saved.');
              } catch (cause) {
                void message.error(
                  getUserErrorMessage(cause, 'Project settings could not be saved.'),
                );
              }
            }}
          >
            <Form.Item label="Project name" name="name" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item label="Project slug">
              <Input disabled value={data.slug} />
            </Form.Item>
            <div className="settings-form-grid">
              <Form.Item label="Timezone" name="timezone" rules={[{ required: true }]}>
                <Input placeholder="Europe/Berlin" />
              </Form.Item>
              <Form.Item label="Locale" name="locale" rules={[{ required: true }]}>
                <Select
                  options={[
                    { label: 'English', value: 'en' },
                    { label: 'Русский', value: 'ru' },
                  ]}
                />
              </Form.Item>
            </div>
            <Form.Item label="Description" name="description">
              <Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} />
            </Form.Item>
            <Button htmlType="submit" icon={<SaveOutlined />} type="primary">
              Save settings
            </Button>
          </Form>
        ) : null}
      </Card>
      {canClone ? (
        <Card className="settings-card settings-card--soft" title="Clone project">
          <Typography.Paragraph type="secondary">
            The clone receives general settings and custom roles. Contacts, channels, credentials,
            messages, automation secrets and history are never copied.
          </Typography.Paragraph>
          <Button icon={<CopyOutlined />} onClick={() => setCloneOpen(true)}>
            Create safe clone
          </Button>
        </Card>
      ) : null}
      <Modal
        destroyOnHidden
        footer={null}
        onCancel={() => setCloneOpen(false)}
        open={canClone && cloneOpen}
        title="Clone project"
      >
        <Form
          form={cloneForm}
          layout="vertical"
          onFinish={async (values: { name: string; slug: string }) => {
            try {
              const cloned = await apiRequest<Project>(
                `/api/v1/projects/${projectId}/clone`,
                { body: JSON.stringify(values), method: 'POST' },
                accessToken,
              );
              await client.invalidateQueries({ queryKey: ['projects'] });
              setCloneOpen(false);
              cloneForm.resetFields();
              void message.success('Project clone created as a draft.');
              void navigate(`/projects/${cloned.id}/settings`);
            } catch (cause) {
              void message.error(getUserErrorMessage(cause, 'The project could not be cloned.'));
            }
          }}
        >
          <Form.Item label="Clone name" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            label="Unique slug"
            name="slug"
            rules={[{ pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, required: true }]}
          >
            <Input />
          </Form.Item>
          <Space>
            <Button onClick={() => setCloneOpen(false)}>Cancel</Button>
            <Button htmlType="submit" type="primary">
              Create clone
            </Button>
          </Space>
        </Form>
      </Modal>
    </section>
  );
}
