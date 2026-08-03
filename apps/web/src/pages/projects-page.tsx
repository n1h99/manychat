import { PlusOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Select,
  Table,
  Typography,
  message,
} from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { ApiError, apiRequest, getUserErrorMessage } from '../api';
import { useAuth } from '../auth';
import { StatusText } from '../status-text';

export interface Project {
  createdAt: string;
  description: string | null;
  id: string;
  locale: string;
  name: string;
  settings: Record<string, unknown>;
  slug: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'DRAFT' | 'PAUSED';
  timezone: string;
  updatedAt: string;
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const { accessToken, identity } = useAuth();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const projects = useQuery({
    queryFn: () => apiRequest<Project[]>('/api/v1/projects', {}, accessToken),
    queryKey: ['projects', accessToken],
  });
  const canCreate = identity?.globalPermissions.includes('projects:create') ?? false;
  const refresh = async () => client.invalidateQueries({ queryKey: ['projects'] });
  return (
    <section>
      <div className="page-heading-row">
        <div>
          <Typography.Title level={2}>Projects</Typography.Title>
          <Typography.Text type="secondary">
            Manage customer workspaces and their operational settings.
          </Typography.Text>
        </div>
        {canCreate ? (
          <Button icon={<PlusOutlined />} onClick={() => setOpen(true)} type="primary">
            Create project
          </Button>
        ) : null}
      </div>
      {projects.isError ? (
        <Alert
          message={getUserErrorMessage(projects.error, 'Projects could not be loaded.')}
          showIcon
          type="error"
        />
      ) : null}
      <Table<Project>
        dataSource={projects.data ?? []}
        loading={projects.isLoading}
        locale={{
          emptyText: (
            <Empty
              description="No projects are available yet"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ),
        }}
        pagination={false}
        rowKey="id"
        columns={[
          {
            dataIndex: 'name',
            render: (name: string) => <Typography.Text strong>{name}</Typography.Text>,
            title: 'Name',
          },
          { dataIndex: 'slug', title: 'Slug' },
          { dataIndex: 'timezone', title: 'Timezone' },
          {
            dataIndex: 'status',
            render: (status: Project['status']) => <StatusText status={status} />,
            title: 'Status',
          },
        ]}
        onRow={(project) => ({
          onClick: () => void navigate(`/projects/${project.id}`),
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              void navigate(`/projects/${project.id}`);
            }
          },
          role: 'link',
          tabIndex: 0,
        })}
        rowClassName="clickable-row"
      />
      <Drawer
        destroyOnHidden
        onClose={() => setOpen(false)}
        open={open}
        title="Create project"
        width={440}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ locale: 'en', timezone: 'UTC' }}
          onFinish={async (values) => {
            try {
              await apiRequest(
                '/api/v1/projects',
                { body: JSON.stringify(values), method: 'POST' },
                accessToken,
              );
              form.resetFields();
              setOpen(false);
              await refresh();
              void message.success('Project created.');
            } catch (error) {
              if (error instanceof ApiError && error.code === 'PROJECT_SLUG_EXISTS') {
                form.setFields([
                  {
                    errors: ['This slug is already used by another active or archived project.'],
                    name: 'slug',
                  },
                ]);
              }
              void message.error(getUserErrorMessage(error, 'Project could not be created.'));
            }
          }}
        >
          <Form.Item label="Name" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Slug" name="slug" rules={[{ pattern: /^[a-z0-9-]+$/, required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Description" name="description">
            <Input.TextArea />
          </Form.Item>
          <Form.Item label="Timezone" name="timezone" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Locale" name="locale" rules={[{ required: true }]}>
            <Select
              options={[
                { label: 'English', value: 'en' },
                { label: 'Русский', value: 'ru' },
              ]}
            />
          </Form.Item>
          <Button block htmlType="submit" type="primary">
            Create
          </Button>
        </Form>
      </Drawer>
    </section>
  );
}
