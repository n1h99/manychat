import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { apiRequest, getUserErrorMessage } from './api';
import { useAuth } from './auth';
import { humanizePermission, humanizePermissionGroup } from './humanize';

interface Permission {
  code: string;
  description: string;
}

interface RoleRow {
  _count: { memberships?: number; userRoles?: number };
  id: string;
  name: string;
  normalizedName: string;
  permissions: Array<{ permission: Permission }>;
  system: boolean;
  updatedAt: string;
}

export function RoleManager({
  canManage = true,
  description,
  permissionsPath,
  queryKey,
  rolesPath,
  title,
}: {
  canManage?: boolean;
  description: string;
  permissionsPath: string;
  queryKey: string;
  rolesPath: string;
  title: string;
}) {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  const [deleteRole, setDeleteRole] = useState<RoleRow>();
  const [deletingRole, setDeletingRole] = useState(false);
  const [editing, setEditing] = useState<RoleRow | null>();
  const [form] = Form.useForm();
  const roles = useQuery({
    queryFn: () => apiRequest<RoleRow[]>(rolesPath, {}, accessToken),
    queryKey: [queryKey, accessToken],
  });
  const permissions = useQuery({
    queryFn: () => apiRequest<Permission[]>(permissionsPath, {}, accessToken),
    queryKey: [`${queryKey}-permissions`, accessToken],
  });
  const groups = useMemo(() => {
    const result = new Map<string, Permission[]>();
    for (const permission of permissions.data ?? []) {
      const group = permission.code.split(':')[0] ?? 'other';
      result.set(group, [...(result.get(group) ?? []), permission]);
    }
    return [...result.entries()];
  }, [permissions.data]);
  const refresh = () => client.invalidateQueries({ queryKey: [queryKey] });
  const close = () => {
    setEditing(undefined);
    form.resetFields();
  };
  return (
    <section className="roles-page">
      <div className="page-heading-row">
        <div>
          <Typography.Title level={2}>{title}</Typography.Title>
          <Typography.Text type="secondary">{description}</Typography.Text>
        </div>
        {canManage ? (
          <Button
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields();
              setEditing(null);
            }}
            type="primary"
          >
            Create role
          </Button>
        ) : null}
      </div>
      {roles.isError || permissions.isError ? (
        <Alert
          message={getUserErrorMessage(
            roles.error ?? permissions.error,
            'Roles could not be loaded.',
          )}
          showIcon
          type="error"
        />
      ) : null}
      <Table<RoleRow>
        columns={[
          {
            render: (_, row) => (
              <div className="role-name-cell">
                <strong>{row.name}</strong>
                <small>{row.system ? 'Built-in role' : 'Custom role'}</small>
              </div>
            ),
            title: 'Role',
          },
          {
            render: (_, row) => (
              <Space size={[4, 4]} wrap>
                {row.permissions.slice(0, 5).map(({ permission }) => (
                  <Tag key={permission.code}>{humanizePermission(permission.code)}</Tag>
                ))}
                {row.permissions.length > 5 ? <Tag>+{row.permissions.length - 5}</Tag> : null}
              </Space>
            ),
            title: 'Permissions',
          },
          {
            render: (_, row) => row._count.memberships ?? row._count.userRoles ?? 0,
            title: 'Assignments',
            width: 120,
          },
          {
            render: (_, row) => (row.system ? <Tag color="blue">System</Tag> : <Tag>Custom</Tag>),
            title: 'Type',
            width: 110,
          },
          {
            align: 'right',
            render: (_, row) =>
              row.system || !canManage ? null : (
                <Space>
                  <Button
                    icon={<EditOutlined />}
                    onClick={() => {
                      form.setFieldsValue({
                        name: row.name,
                        permissionCodes: row.permissions.map(({ permission }) => permission.code),
                      });
                      setEditing(row);
                    }}
                  >
                    Edit
                  </Button>
                  <Button danger onClick={() => setDeleteRole(row)}>
                    Delete
                  </Button>
                </Space>
              ),
            title: 'Actions',
            width: 190,
          },
        ]}
        dataSource={roles.data ?? []}
        loading={roles.isLoading}
        pagination={false}
        rowKey="id"
      />
      <Modal
        className="account-confirm-modal"
        footer={null}
        onCancel={() => setDeleteRole(undefined)}
        open={Boolean(deleteRole)}
        title="Delete this custom role?"
        width={460}
      >
        <Typography.Paragraph type="secondary">
          {deleteRole
            ? `This role will be permanently removed. Assigned roles must be removed from users first.`
            : ''}
        </Typography.Paragraph>
        <div className="modal-form-actions">
          <Button onClick={() => setDeleteRole(undefined)}>Cancel</Button>
          <Button
            danger
            loading={deletingRole}
            onClick={async () => {
              if (!deleteRole) return;
              setDeletingRole(true);
              try {
                await apiRequest(
                  `${rolesPath}/${deleteRole.id}`,
                  { method: 'DELETE' },
                  accessToken,
                );
                await refresh();
                void message.success('Role deleted.');
                setDeleteRole(undefined);
              } catch (cause) {
                void message.error(getUserErrorMessage(cause, 'The role could not be deleted.'));
              } finally {
                setDeletingRole(false);
              }
            }}
          >
            Delete role
          </Button>
        </div>
      </Modal>
      <Modal
        destroyOnHidden
        footer={null}
        onCancel={close}
        open={editing !== undefined}
        title={editing ? 'Edit custom role' : 'Create custom role'}
        width={760}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values: { name: string; permissionCodes?: string[] }) => {
            try {
              const wasEditing = Boolean(editing);
              await apiRequest(
                editing ? `${rolesPath}/${editing.id}` : rolesPath,
                {
                  body: JSON.stringify({
                    name: values.name,
                    permissionCodes: values.permissionCodes ?? [],
                  }),
                  method: editing ? 'PATCH' : 'POST',
                },
                accessToken,
              );
              close();
              await refresh();
              void message.success(wasEditing ? 'Role updated.' : 'Role created.');
            } catch (cause) {
              void message.error(getUserErrorMessage(cause, 'The role could not be saved.'));
            }
          }}
        >
          <Form.Item label="Role name" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Permissions" name="permissionCodes">
            <Checkbox.Group className="permission-group-grid">
              {groups.map(([group, items]) => (
                <div className="permission-group" key={group}>
                  <Typography.Text strong>{humanizePermissionGroup(group)}</Typography.Text>
                  {items.map((permission) => (
                    <Checkbox key={permission.code} value={permission.code}>
                      <span>{humanizePermission(permission.code)}</span>
                      <small>
                        Allow this role to {humanizePermission(permission.code).toLowerCase()}.
                      </small>
                    </Checkbox>
                  ))}
                </div>
              ))}
            </Checkbox.Group>
          </Form.Item>
          <div className="modal-form-actions">
            <Button onClick={close}>Cancel</Button>
            <Button htmlType="submit" type="primary">
              Save role
            </Button>
          </div>
        </Form>
      </Modal>
    </section>
  );
}
