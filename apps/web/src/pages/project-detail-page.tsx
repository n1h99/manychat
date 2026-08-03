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
  SettingOutlined,
  SafetyCertificateOutlined,
  ToolOutlined,
  TagsOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
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

interface ProjectOverview {
  activeBroadcasts: number | null;
  channels: { active: number | null; errors: number | null; total: number | null };
  contacts: number | null;
  createdAt: string;
  members: number | null;
  operationsNeedingAttention: { failed: number; total: number; unknown: number };
  publishedAutomations: number | null;
  updatedAt: string;
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
  const overview = useQuery({
    enabled: Boolean(projectId),
    queryFn: () =>
      apiRequest<ProjectOverview>(`/api/v1/projects/${projectId}/overview`, {}, accessToken),
    queryKey: ['project-overview', projectId, accessToken],
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
      description: 'Custom roles and permissions',
      icon: <SafetyCertificateOutlined />,
      label: 'Roles',
      path: `/projects/${project.id}/roles`,
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
      description: 'Live journeys, outcomes and drop-off reasons',
      icon: <ThunderboltOutlined />,
      label: 'Automation activity',
      path: `/projects/${project.id}/automation-activity`,
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
    {
      description: 'Delivery journals, recovery and audit',
      icon: <ToolOutlined />,
      label: 'Operations',
      path: `/projects/${project.id}/operations`,
    },
    {
      description: 'Workspace identity, locale and cloning',
      icon: <SettingOutlined />,
      label: 'Settings',
      path: `/projects/${project.id}/settings`,
      visible: canManage,
    },
  ];
  const overviewMetrics = [
    {
      detail: 'Active project members',
      icon: <TeamOutlined />,
      label: 'Members',
      path: `/projects/${project.id}/members`,
      value: overview.data?.members ?? 0,
      visible: hasProjectPermission(access.data, 'members:manage'),
    },
    {
      detail: 'Current contact records',
      icon: <ContactsOutlined />,
      label: 'Contacts',
      path: `/projects/${project.id}/contacts`,
      value: overview.data?.contacts ?? 0,
      visible: hasProjectPermission(access.data, 'contacts:read'),
    },
    {
      detail: overview.data
        ? `${overview.data.channels.active ?? 0} connected · ${overview.data.channels.errors ?? 0} need attention`
        : 'Connection status',
      icon: <SendOutlined />,
      label: 'Channels',
      path: `/projects/${project.id}/channels`,
      value: overview.data?.channels.total ?? 0,
      visible: hasProjectPermission(access.data, 'channels:read'),
    },
    {
      detail: 'Published and ready to run',
      icon: <RobotOutlined />,
      label: 'Automations',
      path: `/projects/${project.id}/scenarios`,
      value: overview.data?.publishedAutomations ?? 0,
      visible: hasProjectPermission(access.data, 'automation:read'),
    },
    {
      detail: 'Scheduled, running or paused',
      icon: <SendOutlined />,
      label: 'Active broadcasts',
      path: `/projects/${project.id}/broadcasts`,
      value: overview.data?.activeBroadcasts ?? 0,
      visible: hasProjectPermission(access.data, 'broadcasts:read'),
    },
    {
      detail: overview.data
        ? `${overview.data.operationsNeedingAttention.failed} failed · ${overview.data.operationsNeedingAttention.unknown} need confirmation`
        : 'Failed or unconfirmed work',
      icon: <ToolOutlined />,
      label: 'Need attention',
      path: `/projects/${project.id}/operations`,
      value: overview.data?.operationsNeedingAttention.total ?? 0,
      visible: true,
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

      <Card className="project-overview-card" title="Project overview">
        {overview.isError ? (
          <Alert
            message={getUserErrorMessage(overview.error, 'Project overview could not be loaded.')}
            showIcon
            type="error"
          />
        ) : (
          <div className="project-overview-layout">
            <div className="project-overview-details">
              <div className="project-overview-status-row">
                <div>
                  <span>Workspace status</span>
                  <Tag color={project.status === 'ACTIVE' ? 'green' : 'orange'}>
                    {project.status}
                  </Tag>
                </div>
                <small>{project.slug}</small>
              </div>
              <Typography.Paragraph>
                {project.description || 'No project description has been added yet.'}
              </Typography.Paragraph>
              <div className="project-overview-facts">
                <div>
                  <span>Timezone</span>
                  <strong>{project.timezone}</strong>
                </div>
                <div>
                  <span>Language</span>
                  <strong>{localeLabel(project.locale)}</strong>
                </div>
                <div>
                  <span>Created</span>
                  <strong>
                    {overview.data ? new Date(overview.data.createdAt).toLocaleDateString() : '—'}
                  </strong>
                </div>
                <div>
                  <span>Last updated</span>
                  <strong>
                    {overview.data ? new Date(overview.data.updatedAt).toLocaleString() : '—'}
                  </strong>
                </div>
              </div>
            </div>
            <div className="project-overview-metrics">
              {overviewMetrics
                .filter((metric) => metric.visible)
                .map((metric) => (
                  <Link className="project-overview-metric" key={metric.label} to={metric.path}>
                    <span className="project-overview-metric-icon">{metric.icon}</span>
                    <span>
                      <strong>{overview.isLoading ? '—' : metric.value}</strong>
                      <b>{metric.label}</b>
                      <small>{metric.detail}</small>
                    </span>
                  </Link>
                ))}
            </div>
          </div>
        )}
      </Card>

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
