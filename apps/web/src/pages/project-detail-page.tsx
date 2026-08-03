import {
  ApiOutlined,
  ContactsOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  FileImageOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  SendOutlined,
  TagsOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { apiRequest, getUserErrorMessage } from '../api';
import { useAuth } from '../auth';
import { hasProjectPermission, useProjectAccess } from '../project-access';
import type { Project } from './projects-page';

interface ProjectDestination {
  description: string;
  icon: ReactNode;
  label: string;
  path: string;
  visible?: boolean;
}

function localeLabel(locale: string) {
  return locale === 'ru' ? 'Русский' : locale === 'en' ? 'English' : locale;
}

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const { accessToken } = useAuth();
  const access = useProjectAccess(projectId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form] = Form.useForm();
  const query = useQuery({
    enabled: Boolean(projectId),
    queryFn: () => apiRequest<Project>(`/api/v1/projects/${projectId}`, {}, accessToken),
    queryKey: ['project', projectId, accessToken],
  });

  if (query.isLoading) return <Spin className="route-loading" />;
  if (query.isError || !query.data)
    return (
      <Alert
        message={getUserErrorMessage(query.error, 'Project could not be loaded.')}
        showIcon
        type="error"
      />
    );

  const project = query.data;
  const canManage = hasProjectPermission(access.data, 'project:manage');
  const reload = () => queryClient.invalidateQueries({ queryKey: ['project', projectId] });
  const destinations: ProjectDestination[] = [
    {
      description: 'Roles and project access',
      icon: <TeamOutlined />,
      label: 'Members',
      path: `/projects/${project.id}/members`,
    },
    {
      description: 'People and channel identities',
      icon: <ContactsOutlined />,
      label: 'Contacts',
      path: `/projects/${project.id}/contacts`,
    },
    {
      description: 'Labels and audience groups',
      icon: <TagsOutlined />,
      label: 'Tags & segments',
      path: `/projects/${project.id}/tags`,
    },
    {
      description: 'Project-specific contact data',
      icon: <DatabaseOutlined />,
      label: 'Custom fields',
      path: `/projects/${project.id}/custom-fields`,
    },
    {
      description: 'Scenarios, versions and executions',
      icon: <RobotOutlined />,
      label: 'Automation',
      path: `/projects/${project.id}/scenarios`,
      visible: hasProjectPermission(access.data, 'automation:read'),
    },
    {
      description: 'External customer platform connection',
      icon: <ApiOutlined />,
      label: 'CRM integration',
      path: `/projects/${project.id}/crm-config`,
      visible: hasProjectPermission(access.data, 'integrations:manage'),
    },
    {
      description: 'Telegram bot connections',
      icon: <SendOutlined />,
      label: 'Channels',
      path: `/projects/${project.id}/channels`,
      visible: hasProjectPermission(access.data, 'channels:read'),
    },
    {
      description: 'Telegram broadcasts and delivery',
      icon: <SendOutlined />,
      label: 'Broadcasts',
      path: `/projects/${project.id}/broadcasts`,
      visible: hasProjectPermission(access.data, 'broadcasts:read'),
    },
    {
      description: 'Reusable message content',
      icon: <FileImageOutlined />,
      label: 'Templates',
      path: `/projects/${project.id}/templates`,
      visible: hasProjectPermission(access.data, 'templates:read'),
    },
    {
      description: 'Project media library',
      icon: <FileImageOutlined />,
      label: 'Media',
      path: `/projects/${project.id}/media-assets`,
      visible: hasProjectPermission(access.data, 'media:read'),
    },
  ];

  return (
    <section>
      <div className="page-heading-row">
        <div>
          <Typography.Title level={2}>{project.name}</Typography.Title>
          <Typography.Text type="secondary">{project.slug}</Typography.Text>
        </div>
        {canManage ? (
          <Space wrap>
            <Button
              icon={<EditOutlined />}
              onClick={() => {
                form.setFieldsValue(project);
                setEditing(true);
              }}
            >
              Edit
            </Button>
            <Button
              danger={project.status === 'ACTIVE'}
              icon={project.status === 'ACTIVE' ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
              onClick={async () => {
                try {
                  await apiRequest(
                    `/api/v1/projects/${project.id}/${project.status === 'ACTIVE' ? 'pause' : 'activate'}`,
                    { method: 'POST' },
                    accessToken,
                  );
                  await reload();
                  void message.success(
                    project.status === 'ACTIVE' ? 'Project paused.' : 'Project activated.',
                  );
                } catch (error) {
                  void message.error(
                    getUserErrorMessage(error, 'Project status could not be changed.'),
                  );
                }
              }}
            >
              {project.status === 'ACTIVE' ? 'Pause project' : 'Activate project'}
            </Button>
            <Button danger icon={<DeleteOutlined />} onClick={() => setDeleting(true)}>
              Delete
            </Button>
          </Space>
        ) : null}
      </div>

      <Row className="balanced-card-row" gutter={[18, 18]}>
        <Col xs={24}>
          <Card title="Project details">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Status">
                <Tag color={project.status === 'ACTIVE' ? 'green' : 'orange'}>{project.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Timezone">{project.timezone}</Descriptions.Item>
              <Descriptions.Item label="Locale">{localeLabel(project.locale)}</Descriptions.Item>
              <Descriptions.Item label="Description">
                {project.description || 'No description'}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      <div className="page-heading project-sections-heading">
        <div>
          <Typography.Title level={3}>Project sections</Typography.Title>
          <Typography.Text type="secondary">
            Open the workspace area you want to manage.
          </Typography.Text>
        </div>
      </div>
      <div className="project-navigation-grid">
        {destinations
          .filter((destination) => destination.visible !== false)
          .map((destination) => (
            <Link className="project-navigation-card" key={destination.path} to={destination.path}>
              <span className="project-navigation-icon">{destination.icon}</span>
              <span>
                <strong>{destination.label}</strong>
                <small>{destination.description}</small>
              </span>
            </Link>
          ))}
      </div>
      <Modal
        destroyOnHidden
        footer={null}
        onCancel={() => setEditing(false)}
        open={editing}
        title="Edit project"
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            try {
              await apiRequest(
                `/api/v1/projects/${project.id}`,
                { body: JSON.stringify(values), method: 'PATCH' },
                accessToken,
              );
              setEditing(false);
              await reload();
              void message.success('Project updated.');
            } catch (error) {
              void message.error(getUserErrorMessage(error, 'Project could not be saved.'));
            }
          }}
        >
          <Form.Item label="Name" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Row gutter={14}>
            <Col sm={12} xs={24}>
              <Form.Item label="Timezone" name="timezone" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col sm={12} xs={24}>
              <Form.Item label="Locale" name="locale" rules={[{ required: true }]}>
                <Select
                  options={[
                    { label: 'English', value: 'en' },
                    { label: 'Русский', value: 'ru' },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="Description" name="description">
            <Input.TextArea autoSize={{ maxRows: 5, minRows: 3 }} />
          </Form.Item>
          <Button htmlType="submit" type="primary">
            Save changes
          </Button>
        </Form>
      </Modal>
      <Modal
        cancelText="Keep project"
        okButtonProps={{ danger: true }}
        okText="Delete project"
        onCancel={() => setDeleting(false)}
        onOk={async () => {
          try {
            await apiRequest(`/api/v1/projects/${project.id}`, { method: 'DELETE' }, accessToken);
            setDeleting(false);
            await queryClient.invalidateQueries({ queryKey: ['projects'] });
            void navigate('/projects', { replace: true });
          } catch (error) {
            void message.error(getUserErrorMessage(error, 'Project could not be deleted.'));
          }
        }}
        open={deleting}
        title="Delete this project?"
      >
        The project will be archived and removed from the workspace list. Its audit history remains
        protected.
      </Modal>
    </section>
  );
}
