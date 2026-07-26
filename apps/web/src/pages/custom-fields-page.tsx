import { Button, Drawer, Form, Input, Select, Space, Table, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';

import { apiRequest } from '../api';
import { useAuth } from '../auth';

interface Field {
  id: string;
  key: string;
  name: string;
  type: string;
  options: string[] | null;
  description: string | null;
}
const fieldTypes = [
  'TEXT',
  'NUMBER',
  'BOOLEAN',
  'DATE',
  'DATETIME',
  'SELECT',
  'MULTI_SELECT',
  'JSON',
];

export function CustomFieldsPage() {
  const { projectId } = useParams();
  const { accessToken } = useAuth();
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Field>();
  const [type, setType] = useState('TEXT');
  const [form] = Form.useForm();
  const fields = useQuery({
    enabled: Boolean(projectId),
    queryFn: () =>
      apiRequest<Field[]>(`/api/v1/projects/${projectId}/custom-fields`, {}, accessToken),
    queryKey: ['custom-fields', projectId, accessToken],
  });
  const reload = () => cache.invalidateQueries({ queryKey: ['custom-fields', projectId] });
  return (
    <section>
      <Space className="page-heading" direction="vertical" size={0}>
        <Typography.Title level={2}>Custom fields</Typography.Title>
        <Typography.Text type="secondary">Typed, project-local contact data.</Typography.Text>
      </Space>
      <Button
        onClick={() => {
          form.resetFields();
          setEditing(undefined);
          setType('TEXT');
          setOpen(true);
        }}
        type="primary"
      >
        Create field
      </Button>
      <Table<Field>
        columns={[
          { dataIndex: 'name', title: 'Name' },
          { dataIndex: 'key', title: 'Key' },
          { dataIndex: 'type', title: 'Type' },
          {
            dataIndex: 'options',
            render: (options) => options?.join(', ') ?? '—',
            title: 'Options',
          },
          {
            render: (_, row) => (
              <Space>
                <Button
                  onClick={() => {
                    form.setFieldsValue({ ...row, options: row.options?.join(', ') });
                    setEditing(row);
                    setType(row.type);
                    setOpen(true);
                  }}
                >
                  Edit
                </Button>
                <Button
                  danger
                  onClick={() =>
                    void apiRequest(
                      `/api/v1/projects/${projectId}/custom-fields/${row.id}`,
                      { method: 'DELETE' },
                      accessToken,
                    ).then(reload)
                  }
                >
                  Archive
                </Button>
              </Space>
            ),
            title: 'Actions',
          },
        ]}
        dataSource={fields.data ?? []}
        loading={fields.isLoading}
        pagination={false}
        rowKey="id"
      />
      <Drawer
        destroyOnHidden
        onClose={() => setOpen(false)}
        open={open}
        title={editing ? 'Edit custom field' : 'Create custom field'}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            const payload = {
              ...values,
              options: values.options
                ? values.options
                    .split(',')
                    .map((value: string) => value.trim())
                    .filter(Boolean)
                : undefined,
            };
            await apiRequest(
              `/api/v1/projects/${projectId}/custom-fields${editing ? `/${editing.id}` : ''}`,
              {
                body: JSON.stringify(
                  editing
                    ? {
                        description: payload.description,
                        name: payload.name,
                        options: payload.options,
                      }
                    : payload,
                ),
                method: editing ? 'PATCH' : 'POST',
              },
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
          <Form.Item
            label="Key"
            name="key"
            rules={[{ pattern: /^[a-z][a-z0-9_]{0,63}$/, required: true }]}
          >
            <Input disabled={Boolean(editing)} />
          </Form.Item>
          <Form.Item label="Type" name="type" rules={[{ required: true }]}>
            <Select
              disabled={Boolean(editing)}
              onChange={setType}
              options={fieldTypes.map((value) => ({ value }))}
            />
          </Form.Item>
          {type === 'SELECT' || type === 'MULTI_SELECT' ? (
            <Form.Item
              label="Options (comma-separated)"
              name="options"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
          ) : null}
          <Form.Item label="Description" name="description">
            <Input.TextArea />
          </Form.Item>
          <Button htmlType="submit" type="primary">
            {editing ? 'Save changes' : 'Create'}
          </Button>
        </Form>
      </Drawer>
    </section>
  );
}
