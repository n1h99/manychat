import { Alert, Button, Card, Form, Input, Modal, Select, Space, Typography, message } from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  SaveOutlined,
} from '@ant-design/icons';
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
  const [deleteOpen, setDeleteOpen] = useState(false);
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
      <div className="page-heading-row project-settings-heading">
        <div>
          <Typography.Title level={2}>Project settings</Typography.Title>
          <Typography.Text type="secondary">
            Workspace identity, locale and safe project cloning.
          </Typography.Text>
        </div>
      </div>
      <div className={`project-settings-grid${canClone || data ? '' : ' is-single'}`}>
        <Card className="settings-card settings-card--general" title="General">
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
        {canClone || data ? (
          <Card className="settings-card settings-card--soft" title="Project actions">
            <div className="clone-project-card-content">
              {canClone ? (
                <>
                  <div>
                    <Typography.Title level={4}>Start from this workspace</Typography.Title>
                    <Typography.Paragraph type="secondary">
                      Copy the project settings and custom roles into a clean draft workspace.
                    </Typography.Paragraph>
                  </div>
                  <div className="clone-project-boundary">
                    <strong>Customer data stays separate</strong>
                    <span>
                      Contacts, channels, credentials, messages, automation secrets and history are
                      never copied.
                    </span>
                  </div>
                  <Button
                    block
                    icon={<CopyOutlined />}
                    onClick={() => setCloneOpen(true)}
                    type="primary"
                  >
                    Create safe clone
                  </Button>
                </>
              ) : null}
              {data ? (
                <div className="project-lifecycle-actions">
                  <div className="project-lifecycle-action">
                    <div className="clone-project-boundary">
                      <strong>
                        {data.status === 'ACTIVE'
                          ? 'Pause without losing data'
                          : 'Activate this workspace'}
                      </strong>
                      <span>
                        {data.status === 'ACTIVE'
                          ? 'New automation work waits until you activate the project again. Settings, contacts and history stay in place.'
                          : 'New automation work can continue after activation. Existing settings, contacts and history stay in place.'}
                      </span>
                    </div>
                    <Button
                      block
                      danger={data.status === 'ACTIVE'}
                      icon={
                        data.status === 'ACTIVE' ? <PauseCircleOutlined /> : <PlayCircleOutlined />
                      }
                      onClick={async () => {
                        try {
                          await apiRequest(
                            `/api/v1/projects/${projectId}/${data.status === 'ACTIVE' ? 'pause' : 'activate'}`,
                            { method: 'POST' },
                            accessToken,
                          );
                          await client.invalidateQueries({
                            queryKey: ['project', projectId],
                          });
                          void message.success(
                            data.status === 'ACTIVE' ? 'Project paused.' : 'Project activated.',
                          );
                        } catch (cause) {
                          void message.error(
                            getUserErrorMessage(cause, 'Project status could not be changed.'),
                          );
                        }
                      }}
                    >
                      {data.status === 'ACTIVE' ? 'Pause project' : 'Activate project'}
                    </Button>
                  </div>
                  <div className="project-lifecycle-action">
                    <div className="clone-project-boundary">
                      <strong>Remove it from the workspace list</strong>
                      <span>
                        Deleting archives the project and keeps its protected audit history. It will
                        no longer appear in the workspace list.
                      </span>
                    </div>
                    <Button
                      block
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => setDeleteOpen(true)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </Card>
        ) : null}
      </div>
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
      <Modal
        cancelText="Keep project"
        okButtonProps={{ danger: true }}
        okText="Delete project"
        onCancel={() => setDeleteOpen(false)}
        onOk={async () => {
          try {
            await apiRequest(`/api/v1/projects/${projectId}`, { method: 'DELETE' }, accessToken);
            setDeleteOpen(false);
            await client.invalidateQueries({ queryKey: ['projects'] });
            void navigate('/projects', { replace: true });
          } catch (cause) {
            void message.error(getUserErrorMessage(cause, 'Project could not be deleted.'));
          }
        }}
        open={deleteOpen}
        title="Delete this project?"
      >
        The project will be archived and removed from the workspace list. Its audit history remains
        protected.
      </Modal>
    </section>
  );
}
