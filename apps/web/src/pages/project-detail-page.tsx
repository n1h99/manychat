import { Button, Descriptions, Form, Input, Space, Spin, Tag, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';

import { apiRequest } from '../api';
import { useAuth } from '../auth';
import { hasProjectPermission, useProjectAccess } from '../project-access';
import type { Project } from './projects-page';

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const { accessToken } = useAuth();
  const access = useProjectAccess(projectId);
  const queryClient = useQueryClient();
  const query = useQuery({
    enabled: Boolean(projectId),
    queryFn: () => apiRequest<Project>(`/api/v1/projects/${projectId}`, {}, accessToken),
    queryKey: ['project', projectId, accessToken],
  });
  if (query.isLoading || !query.data) return <Spin />;
  const project = query.data;
  const reload = () => queryClient.invalidateQueries({ queryKey: ['project', projectId] });
  return (
    <section>
      <Space className="page-heading" direction="vertical" size={0}>
        <Typography.Title level={2}>{project.name}</Typography.Title>
        <Typography.Text type="secondary">{project.slug}</Typography.Text>
      </Space>
      <Descriptions bordered column={1}>
        <Descriptions.Item label="Status">
          <Tag color={project.status === 'ACTIVE' ? 'green' : 'orange'}>{project.status}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Timezone">{project.timezone}</Descriptions.Item>
        <Descriptions.Item label="Locale">{project.locale}</Descriptions.Item>
      </Descriptions>
      <Space className="section-actions">
        <Button
          onClick={async () => {
            await apiRequest(
              `/api/v1/projects/${project.id}/${project.status === 'ACTIVE' ? 'pause' : 'activate'}`,
              { method: 'POST' },
              accessToken,
            );
            await reload();
          }}
        >
          {project.status === 'ACTIVE' ? 'Pause' : 'Activate'}
        </Button>
        <Link to={`/projects/${project.id}/members`}>Manage members</Link>
        <Link to={`/projects/${project.id}/contacts`}>Contacts</Link>
        <Link to={`/projects/${project.id}/tags`}>Tags</Link>
        <Link to={`/projects/${project.id}/custom-fields`}>Custom fields</Link>
        <Link to={`/projects/${project.id}/segments`}>Segments</Link>
        {hasProjectPermission(access.data, 'automation:read') ? (
          <Link to={`/projects/${project.id}/scenarios`}>Automation</Link>
        ) : null}
        {hasProjectPermission(access.data, 'integrations:manage') ? (
          <Link to={`/projects/${project.id}/crm-config`}>CRM mock</Link>
        ) : null}
        {hasProjectPermission(access.data, 'channels:read') ? (
          <Link to={`/projects/${project.id}/channels`}>Channels</Link>
        ) : null}
        {hasProjectPermission(access.data, 'broadcasts:read') ? (
          <Link to={`/projects/${project.id}/broadcasts`}>Broadcasts</Link>
        ) : null}
        {hasProjectPermission(access.data, 'templates:read') ? (
          <Link to={`/projects/${project.id}/templates`}>Templates</Link>
        ) : null}
        {hasProjectPermission(access.data, 'media:read') ? (
          <Link to={`/projects/${project.id}/media-assets`}>Media</Link>
        ) : null}
      </Space>
      <Typography.Title level={4}>Edit project</Typography.Title>
      <Form
        initialValues={project}
        layout="vertical"
        onFinish={async (values) => {
          await apiRequest(
            `/api/v1/projects/${project.id}`,
            { body: JSON.stringify(values), method: 'PATCH' },
            accessToken,
          );
          await reload();
        }}
      >
        <Form.Item label="Name" name="name">
          <Input />
        </Form.Item>
        <Form.Item label="Description" name="description">
          <Input.TextArea />
        </Form.Item>
        <Form.Item label="Timezone" name="timezone">
          <Input />
        </Form.Item>
        <Form.Item label="Locale" name="locale">
          <Input />
        </Form.Item>
        <Button htmlType="submit" type="primary">
          Save changes
        </Button>
      </Form>
    </section>
  );
}
