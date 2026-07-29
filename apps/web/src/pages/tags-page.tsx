import { PlusOutlined } from '@ant-design/icons';
import { Button, Drawer, Form, Input, Space, Table, Tag, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';

import { apiRequest } from '../api';
import { useAuth } from '../auth';

interface TagItem {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
}

export function TagsPage() {
  const { projectId } = useParams();
  const { accessToken } = useAuth();
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TagItem>();
  const [form] = Form.useForm();
  const tags = useQuery({
    enabled: Boolean(projectId),
    queryFn: () => apiRequest<TagItem[]>(`/api/v1/projects/${projectId}/tags`, {}, accessToken),
    queryKey: ['tags', projectId, accessToken],
  });
  const reload = () => cache.invalidateQueries({ queryKey: ['tags', projectId] });
  return (
    <section>
      <div className="page-heading-row">
        <div>
          <Typography.Text className="header-kicker">Audience</Typography.Text>
          <Typography.Title level={2}>Tags</Typography.Title>
          <Typography.Text type="secondary">
            Organize contacts with project-specific labels.
          </Typography.Text>
        </div>
        <Button
          icon={<PlusOutlined />}
          onClick={() => {
            form.resetFields();
            setEditing(undefined);
            setOpen(true);
          }}
          type="primary"
        >
          Create tag
        </Button>
      </div>
      <Table<TagItem>
        columns={[
          {
            dataIndex: 'name',
            render: (name, row) => <Tag {...(row.color ? { color: row.color } : {})}>{name}</Tag>,
            title: 'Name',
          },
          { dataIndex: 'description', title: 'Description' },
          {
            render: (_, row) => (
              <Space>
                <Button
                  onClick={() => {
                    form.setFieldsValue(row);
                    setEditing(row);
                    setOpen(true);
                  }}
                >
                  Edit
                </Button>
                <Button
                  danger
                  onClick={() =>
                    void apiRequest(
                      `/api/v1/projects/${projectId}/tags/${row.id}`,
                      { method: 'DELETE' },
                      accessToken,
                    ).then(reload)
                  }
                >
                  Delete
                </Button>
              </Space>
            ),
            title: 'Actions',
          },
        ]}
        dataSource={tags.data ?? []}
        loading={tags.isLoading}
        pagination={false}
        rowKey="id"
      />
      <Drawer
        destroyOnHidden
        onClose={() => setOpen(false)}
        open={open}
        title={editing ? 'Edit tag' : 'Create tag'}
        width={440}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            await apiRequest(
              `/api/v1/projects/${projectId}/tags${editing ? `/${editing.id}` : ''}`,
              { body: JSON.stringify(values), method: editing ? 'PATCH' : 'POST' },
              accessToken,
            );
            form.resetFields();
            setOpen(false);
            await reload();
          }}
        >
          <Form.Item label="Name" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Color" name="color" rules={[{ pattern: /^#[0-9A-Fa-f]{6}$/ }]}>
            <Input placeholder="#1677ff" />
          </Form.Item>
          <Form.Item label="Description" name="description">
            <Input.TextArea />
          </Form.Item>
          <Button block htmlType="submit" type="primary">
            {editing ? 'Save changes' : 'Create'}
          </Button>
        </Form>
      </Drawer>
    </section>
  );
}
