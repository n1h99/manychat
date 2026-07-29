import { PlusOutlined } from '@ant-design/icons';
import { Button, Drawer, Form, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { apiRequest } from '../api';
import { useAuth } from '../auth';

interface UserRow {
  email: string;
  firstName: string;
  globalRoles: Array<{ globalRole: { id: string; name: string } }>;
  id: string;
  lastName: string;
  status: string;
}

export function UsersPage() {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow>();
  const [form] = Form.useForm();
  const users = useQuery({
    queryFn: () => apiRequest<UserRow[]>('/api/v1/users', {}, accessToken),
    queryKey: ['users', accessToken],
  });
  const globalRoles = useQuery({
    queryFn: () =>
      apiRequest<Array<{ id: string; name: string }>>(
        '/api/v1/users/roles/global',
        {},
        accessToken,
      ),
    queryKey: ['global-roles', accessToken],
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['users'] });
  return (
    <section>
      <div className="page-heading-row">
        <div>
          <Typography.Text className="header-kicker">Administration</Typography.Text>
          <Typography.Title level={2}>Users</Typography.Title>
          <Typography.Text type="secondary">
            Global administration users and their system roles.
          </Typography.Text>
        </div>
        <Button icon={<PlusOutlined />} onClick={() => setOpen(true)} type="primary">
          Create user
        </Button>
      </div>
      <Table<UserRow>
        dataSource={users.data ?? []}
        loading={users.isLoading}
        pagination={false}
        rowKey="id"
        columns={[
          { render: (_, row) => `${row.firstName} ${row.lastName}`, title: 'Name' },
          { dataIndex: 'email', title: 'Email' },
          {
            render: (_, row) =>
              row.globalRoles.map(({ globalRole }) => (
                <Tag key={globalRole.id}>{globalRole.name}</Tag>
              )),
            title: 'Global roles',
          },
          { dataIndex: 'status', title: 'Status' },
          {
            render: (_, row) => (
              <Space>
                <Button
                  onClick={() => {
                    setEditing(row);
                    form.setFieldsValue({
                      firstName: row.firstName,
                      globalRoleIds: row.globalRoles.map(({ globalRole }) => globalRole.id),
                      lastName: row.lastName,
                    });
                    setOpen(true);
                  }}
                  size="small"
                >
                  Edit
                </Button>
                <Button
                  size="small"
                  onClick={async () => {
                    await apiRequest(
                      `/api/v1/users/${row.id}/revoke-sessions`,
                      { method: 'POST' },
                      accessToken,
                    );
                  }}
                >
                  Revoke sessions
                </Button>
                <Button
                  danger
                  disabled={row.status !== 'ACTIVE'}
                  size="small"
                  onClick={async () => {
                    await apiRequest(
                      `/api/v1/users/${row.id}/disable`,
                      { method: 'POST' },
                      accessToken,
                    );
                    await refresh();
                  }}
                >
                  Disable
                </Button>
              </Space>
            ),
            title: 'Actions',
          },
        ]}
      />
      <Drawer
        destroyOnHidden
        onClose={() => {
          setEditing(undefined);
          form.resetFields();
          setOpen(false);
        }}
        open={open}
        title={editing ? 'Edit user' : 'Create user'}
        width={440}
      >
        <Typography.Paragraph type="secondary">
          The temporary password must be delivered through an approved out-of-band channel.
        </Typography.Paragraph>
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            await apiRequest(
              editing ? `/api/v1/users/${editing.id}` : '/api/v1/users',
              { body: JSON.stringify(values), method: editing ? 'PATCH' : 'POST' },
              accessToken,
            );
            setEditing(undefined);
            form.resetFields();
            setOpen(false);
            await refresh();
          }}
        >
          {editing ? null : (
            <Form.Item label="Email" name="email" rules={[{ required: true, type: 'email' }]}>
              <Input />
            </Form.Item>
          )}
          <Form.Item label="First name" name="firstName" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Last name" name="lastName" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          {editing ? null : (
            <Form.Item
              label="Temporary password"
              name="temporaryPassword"
              rules={[{ min: 12, required: true }]}
            >
              <Input.Password />
            </Form.Item>
          )}
          <Form.Item label="Global roles" name="globalRoleIds">
            <Select
              mode="multiple"
              options={globalRoles.data ?? []}
              fieldNames={{ label: 'name', value: 'id' }}
              placeholder="Optional global roles"
            />
          </Form.Item>
          <Button block htmlType="submit" type="primary">
            {editing ? 'Save changes' : 'Create'}
          </Button>
        </Form>
      </Drawer>
    </section>
  );
}
