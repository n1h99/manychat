import { Button, Drawer, Form, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { apiRequest } from '../api';
import { useAuth } from '../auth';

export interface Project {
  description: string | null;
  id: string;
  locale: string;
  name: string;
  settings: Record<string, unknown>;
  slug: string;
  status: 'ACTIVE' | 'PAUSED';
  timezone: string;
}

export function ProjectsPage() {
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
      <Space className="page-heading" direction="vertical" size={0}>
        <Typography.Title level={2}>Projects</Typography.Title>
        <Typography.Text type="secondary">Projects available to your account.</Typography.Text>
      </Space>
      {canCreate ? (
        <Button onClick={() => setOpen(true)} type="primary">
          Create project
        </Button>
      ) : null}
      <Table<Project>
        dataSource={projects.data ?? []}
        loading={projects.isLoading}
        pagination={false}
        rowKey="id"
        columns={[
          {
            dataIndex: 'name',
            render: (name: string, record) => <Link to={`/projects/${record.id}`}>{name}</Link>,
            title: 'Name',
          },
          { dataIndex: 'slug', title: 'Slug' },
          { dataIndex: 'timezone', title: 'Timezone' },
          {
            dataIndex: 'status',
            render: (status: Project['status']) => (
              <Tag color={status === 'ACTIVE' ? 'green' : 'orange'}>{status}</Tag>
            ),
            title: 'Status',
          },
        ]}
      />
      <Drawer destroyOnHidden onClose={() => setOpen(false)} open={open} title="Create project">
        <Form
          form={form}
          layout="vertical"
          initialValues={{ locale: 'en', timezone: 'UTC' }}
          onFinish={async (values) => {
            await apiRequest(
              '/api/v1/projects',
              { body: JSON.stringify(values), method: 'POST' },
              accessToken,
            );
            form.resetFields();
            setOpen(false);
            await refresh();
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
            <Select options={[{ value: 'en' }, { value: 'ru' }]} />
          </Form.Item>
          <Button htmlType="submit" type="primary">
            Create
          </Button>
        </Form>
      </Drawer>
    </section>
  );
}
