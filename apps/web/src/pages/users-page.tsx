import {
  EditOutlined,
  EnvironmentOutlined,
  KeyOutlined,
  LinkOutlined,
  MailOutlined,
  PlusOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  SafetyCertificateOutlined,
  StopOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { apiRequest, getUserErrorMessage } from '../api';
import { useAuth } from '../auth';
import { StatusText } from '../status-text';

interface GlobalRole {
  id: string;
  name: string;
  normalizedName: string;
}

interface UserRow {
  city: string | null;
  country: string | null;
  createdAt: string;
  email: string;
  firstName: string;
  globalRoles: Array<{ globalRole: GlobalRole }>;
  id: string;
  lastName: string;
  region: string | null;
  status: 'ACTIVE' | 'DISABLED';
}

interface UserFormValues {
  city?: string;
  country?: string;
  email: string;
  firstName: string;
  globalRoleIds?: string[];
  lastName: string;
  newPassword?: string;
  region?: string;
  temporaryPassword?: string;
}

function fullName(user: Pick<UserRow, 'firstName' | 'lastName'>): string {
  return `${user.firstName} ${user.lastName}`.trim();
}

function locationLabel(user: Pick<UserRow, 'city' | 'country' | 'region'>): string {
  return [user.city, user.region, user.country].filter(Boolean).join(', ') || 'Not set';
}

export function UsersPage() {
  const { accessToken, identity } = useAuth();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow>();
  const [disableTarget, setDisableTarget] = useState<UserRow>();
  const [activateTarget, setActivateTarget] = useState<UserRow>();
  const [deleteTarget, setDeleteTarget] = useState<UserRow>();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [secureLink, setSecureLink] = useState<{ expiresAt: string; title: string; url: string }>();
  const [form] = Form.useForm<UserFormValues>();
  const canManage =
    identity?.globalRoleNames.includes('super-admin') ||
    identity?.globalPermissions.includes('users:manage');
  const users = useQuery({
    queryFn: () => apiRequest<UserRow[]>('/api/v1/users', {}, accessToken),
    queryKey: ['users', accessToken],
  });
  const globalRoles = useQuery({
    queryFn: () => apiRequest<GlobalRole[]>('/api/v1/users/roles/global', {}, accessToken),
    queryKey: ['global-roles', accessToken],
  });
  const invitations = useQuery({
    enabled: Boolean(canManage),
    queryFn: () =>
      apiRequest<
        Array<{
          acceptedAt: string | null;
          emailSnapshot: string;
          expiresAt: string;
          globalRole: { name: string };
          id: string;
          revokedAt: string | null;
        }>
      >('/api/v1/users/invitations', {}, accessToken),
    queryKey: ['global-invitations', accessToken],
  });
  const summary = useMemo(() => {
    const rows = users.data ?? [];
    return {
      active: rows.filter((user) => user.status === 'ACTIVE').length,
      admins: rows.filter((user) =>
        user.globalRoles.some(({ globalRole }) => globalRole.normalizedName === 'super-admin'),
      ).length,
      total: rows.length,
    };
  }, [users.data]);
  const refresh = async () => client.invalidateQueries({ queryKey: ['users'] });

  const closeEditor = () => {
    setEditing(undefined);
    form.resetFields();
    setOpen(false);
  };

  const openCreate = () => {
    setEditing(undefined);
    form.resetFields();
    setOpen(true);
  };

  const openEdit = (user: UserRow) => {
    setEditing(user);
    form.setFieldsValue({
      city: user.city ?? '',
      country: user.country ?? '',
      email: user.email,
      firstName: user.firstName,
      globalRoleIds: user.globalRoles.map(({ globalRole }) => globalRole.id),
      lastName: user.lastName,
      region: user.region ?? '',
    });
    setOpen(true);
  };

  return (
    <section className="users-page">
      <div className="users-overview surface">
        <div className="page-heading-row users-heading">
          <div>
            <Typography.Title level={2}>Users</Typography.Title>
            <Typography.Text type="secondary">
              Manage Omnicus accounts, profile details and assigned system roles.
            </Typography.Text>
          </div>
          {canManage ? (
            <Space>
              <Button icon={<MailOutlined />} onClick={() => setInviteOpen(true)}>
                Invite user
              </Button>
              <Button icon={<PlusOutlined />} onClick={openCreate} type="primary">
                Create user
              </Button>
            </Space>
          ) : null}
        </div>
        <div className="users-summary-grid">
          <div className="users-summary-item">
            <span>Total users</span>
            <strong>{summary.total}</strong>
          </div>
          <div className="users-summary-item">
            <span>Active accounts</span>
            <strong>{summary.active}</strong>
          </div>
          <div className="users-summary-item">
            <span>System administrators</span>
            <strong>{summary.admins}</strong>
          </div>
        </div>
      </div>

      <div className="users-table-card surface">
        {users.isError || globalRoles.isError ? (
          <Alert
            className="form-alert"
            message={getUserErrorMessage(
              users.error ?? globalRoles.error,
              'User accounts could not be loaded.',
            )}
            showIcon
            type="error"
          />
        ) : null}
        <Table<UserRow>
          columns={[
            {
              render: (_, row) => (
                <div className="user-name-cell">
                  <span className="user-initials">
                    {row.firstName.slice(0, 1)}
                    {row.lastName.slice(0, 1)}
                  </span>
                  <div>
                    <Typography.Text strong>{fullName(row)}</Typography.Text>
                  </div>
                </div>
              ),
              title: 'Name',
              width: 180,
            },
            {
              dataIndex: 'email',
              ellipsis: true,
              render: (value: string) => <Typography.Text>{value}</Typography.Text>,
              title: 'Email',
              width: 205,
            },
            {
              render: (_, row) => (
                <Space size={[6, 6]} wrap>
                  {row.globalRoles.length > 0 ? (
                    row.globalRoles.map(({ globalRole }) => (
                      <Tag className="user-role-tag" key={globalRole.id}>
                        {globalRole.name}
                      </Tag>
                    ))
                  ) : (
                    <Typography.Text type="secondary">No global role</Typography.Text>
                  )}
                </Space>
              ),
              title: 'Roles',
              width: 145,
            },
            {
              render: (_, row) => {
                const location = locationLabel(row);
                return location === 'Not set' ? (
                  <Typography.Text className="user-location-cell" type="secondary">
                    {location}
                  </Typography.Text>
                ) : (
                  <Typography.Text className="user-location-cell">{location}</Typography.Text>
                );
              },
              title: 'Location',
              width: 160,
            },
            {
              render: (_, row) => <StatusText status={row.status} />,
              title: 'Status',
              width: 90,
            },
            {
              dataIndex: 'createdAt',
              render: (value: string) => new Intl.DateTimeFormat('en-GB').format(new Date(value)),
              title: 'Created',
              width: 90,
            },
            {
              align: 'right',
              render: (_, row) =>
                canManage ? (
                  <Space size={8}>
                    <Button
                      aria-label={`Edit ${fullName(row)}`}
                      icon={<EditOutlined />}
                      onClick={() => openEdit(row)}
                    />
                    <Button
                      aria-label={`Revoke sessions for ${fullName(row)}`}
                      icon={<SafetyCertificateOutlined />}
                      onClick={async () => {
                        try {
                          await apiRequest(
                            `/api/v1/users/${row.id}/revoke-sessions`,
                            { method: 'POST' },
                            accessToken,
                          );
                          void message.success('User sessions revoked.');
                        } catch (error) {
                          void message.error(
                            getUserErrorMessage(error, 'User sessions could not be revoked.'),
                          );
                        }
                      }}
                    />
                    <Button
                      aria-label={`Reset password for ${fullName(row)}`}
                      icon={<LinkOutlined />}
                      onClick={async () => {
                        try {
                          const result = await apiRequest<{
                            expiresAt: string;
                            resetUrl: string;
                          }>(
                            `/api/v1/users/${row.id}/password-reset-link`,
                            { method: 'POST' },
                            accessToken,
                          );
                          setSecureLink({
                            expiresAt: result.expiresAt,
                            title: 'Password reset link',
                            url: result.resetUrl,
                          });
                        } catch (error) {
                          void message.error(
                            getUserErrorMessage(error, 'The reset link could not be created.'),
                          );
                        }
                      }}
                    />
                    <Button
                      aria-label={`Disable ${fullName(row)}`}
                      danger
                      disabled={row.status !== 'ACTIVE'}
                      icon={<StopOutlined />}
                      onClick={() => setDisableTarget(row)}
                    />
                    <Button
                      aria-label={`Activate ${fullName(row)}`}
                      disabled={row.status !== 'DISABLED'}
                      icon={<CheckCircleOutlined />}
                      onClick={() => setActivateTarget(row)}
                    />
                    <Button
                      aria-label={`Delete ${fullName(row)}`}
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => setDeleteTarget(row)}
                    />
                  </Space>
                ) : null,
              title: 'Actions',
              width: 285,
            },
          ]}
          dataSource={users.data ?? []}
          loading={users.isLoading}
          locale={{
            emptyText: (
              <Empty description="No user accounts found" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ),
          }}
          pagination={{ hideOnSinglePage: true, pageSize: 10, showSizeChanger: false }}
          rowKey="id"
          tableLayout="fixed"
        />
      </div>

      {canManage ? (
        <div className="users-table-card surface">
          <div className="section-heading-inline">
            <div>
              <Typography.Title level={4}>Invitations</Typography.Title>
              <Typography.Text type="secondary">
                Recent one-time access links and their status.
              </Typography.Text>
            </div>
          </div>
          <Table
            dataSource={invitations.data ?? []}
            loading={invitations.isLoading}
            pagination={{ hideOnSinglePage: true, pageSize: 8 }}
            rowKey="id"
            columns={[
              { dataIndex: 'emailSnapshot', title: 'Email' },
              { dataIndex: ['globalRole', 'name'], title: 'Role' },
              {
                render: (_, row) => {
                  const label = row.acceptedAt
                    ? 'Accepted'
                    : row.revokedAt
                      ? 'Revoked'
                      : new Date(row.expiresAt) <= new Date()
                        ? 'Expired'
                        : 'Active';
                  return <StatusText label={label} status={label.toUpperCase()} />;
                },
                title: 'Status',
              },
              {
                dataIndex: 'expiresAt',
                render: (value) => new Date(value).toLocaleString(),
                title: 'Expires',
              },
            ]}
          />
        </div>
      ) : null}

      <Modal
        className="user-editor-modal"
        destroyOnHidden
        footer={null}
        onCancel={closeEditor}
        open={open}
        width={700}
      >
        <div className="modal-title-block">
          <span className="modal-title-icon">{editing ? <EditOutlined /> : <PlusOutlined />}</span>
          <div>
            <Typography.Title level={3}>
              {editing ? `Edit user — ${fullName(editing)}` : 'Create user'}
            </Typography.Title>
            <Typography.Text type="secondary">
              {editing
                ? 'Update account details, access and location.'
                : 'Create an account and assign its system access.'}
            </Typography.Text>
          </div>
        </div>
        <Form<UserFormValues>
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            const payload = editing
              ? {
                  city: values.city ?? '',
                  country: values.country ?? '',
                  email: values.email,
                  firstName: values.firstName,
                  globalRoleIds: values.globalRoleIds ?? [],
                  lastName: values.lastName,
                  ...(values.newPassword ? { newPassword: values.newPassword } : {}),
                  region: values.region ?? '',
                }
              : {
                  city: values.city ?? '',
                  country: values.country ?? '',
                  email: values.email,
                  firstName: values.firstName,
                  globalRoleIds: values.globalRoleIds ?? [],
                  lastName: values.lastName,
                  region: values.region ?? '',
                  temporaryPassword: values.temporaryPassword,
                };
            try {
              await apiRequest(
                editing ? `/api/v1/users/${editing.id}` : '/api/v1/users',
                { body: JSON.stringify(payload), method: editing ? 'PATCH' : 'POST' },
                accessToken,
              );
              void message.success(editing ? 'User account updated.' : 'User account created.');
              closeEditor();
              await refresh();
            } catch (error) {
              void message.error(
                getUserErrorMessage(error, 'The user account could not be saved.'),
              );
            }
          }}
        >
          <section className="account-form-section">
            <div className="account-form-section-title">
              <UserOutlined />
              <span>Account</span>
            </div>
            <div className="account-form-grid account-form-grid--two">
              <Form.Item label="First name" name="firstName" rules={[{ required: true }]}>
                <Input autoComplete="given-name" />
              </Form.Item>
              <Form.Item label="Last name" name="lastName" rules={[{ required: true }]}>
                <Input autoComplete="family-name" />
              </Form.Item>
            </div>
            <Form.Item label="Email" name="email" rules={[{ required: true, type: 'email' }]}>
              <Input autoComplete="email" />
            </Form.Item>
            <Form.Item
              extra={editing ? 'Leave empty to keep the current password.' : undefined}
              label={editing ? 'New password' : 'Temporary password'}
              name={editing ? 'newPassword' : 'temporaryPassword'}
              rules={[{ min: 12, required: !editing }]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          </section>

          <section className="account-form-section">
            <div className="account-form-section-title">
              <KeyOutlined />
              <span>Access</span>
            </div>
            <Form.Item label="Global roles" name="globalRoleIds">
              <Select
                fieldNames={{ label: 'name', value: 'id' }}
                loading={globalRoles.isLoading}
                mode="multiple"
                options={globalRoles.data ?? []}
                placeholder="Select system roles"
              />
            </Form.Item>
          </section>

          <section className="account-form-section">
            <div className="account-form-section-title">
              <EnvironmentOutlined />
              <span>Location</span>
            </div>
            <div className="account-form-grid account-form-grid--three">
              <Form.Item label="Country" name="country">
                <Input autoComplete="country-name" />
              </Form.Item>
              <Form.Item label="Region / area" name="region">
                <Input autoComplete="address-level1" />
              </Form.Item>
              <Form.Item label="City" name="city">
                <Input autoComplete="address-level2" />
              </Form.Item>
            </div>
          </section>

          <div className="modal-form-actions">
            <Button onClick={closeEditor}>Cancel</Button>
            <Button htmlType="submit" type="primary">
              {editing ? 'Save changes' : 'Create user'}
            </Button>
          </div>
        </Form>
      </Modal>
      <Modal
        destroyOnHidden
        footer={null}
        onCancel={() => setInviteOpen(false)}
        open={inviteOpen}
        title="Invite system user"
      >
        <Form
          layout="vertical"
          onFinish={async (values: { email: string; globalRoleId: string }) => {
            try {
              const result = await apiRequest<{ expiresAt: string; invitationUrl: string }>(
                '/api/v1/users/invitations',
                { body: JSON.stringify(values), method: 'POST' },
                accessToken,
              );
              setInviteOpen(false);
              setSecureLink({
                expiresAt: result.expiresAt,
                title: 'Invitation link',
                url: result.invitationUrl,
              });
              await client.invalidateQueries({ queryKey: ['global-invitations'] });
            } catch (error) {
              void message.error(
                getUserErrorMessage(error, 'The invitation could not be created.'),
              );
            }
          }}
        >
          <Form.Item label="Email" name="email" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="System role" name="globalRoleId" rules={[{ required: true }]}>
            <Select fieldNames={{ label: 'name', value: 'id' }} options={globalRoles.data ?? []} />
          </Form.Item>
          <Button htmlType="submit" type="primary">
            Create invitation
          </Button>
        </Form>
      </Modal>
      <Modal
        footer={null}
        onCancel={() => setSecureLink(undefined)}
        open={Boolean(secureLink)}
        title={secureLink?.title}
      >
        <Alert
          className="form-alert"
          description={`This value is shown once and expires ${secureLink ? new Date(secureLink.expiresAt).toLocaleString() : ''}. Share it only through a trusted channel.`}
          message="One-time secure link"
          showIcon
          type="warning"
        />
        <Input.TextArea readOnly autoSize={{ minRows: 3, maxRows: 5 }} value={secureLink?.url} />
        <Button
          className="secure-link-copy"
          onClick={async () => {
            if (!secureLink) return;
            await navigator.clipboard.writeText(secureLink.url);
            void message.success('Secure link copied.');
          }}
          type="primary"
        >
          Copy link
        </Button>
      </Modal>

      <Modal
        className="account-confirm-modal"
        footer={null}
        onCancel={() => setDisableTarget(undefined)}
        open={Boolean(disableTarget)}
        title="Disable user account?"
        width={460}
      >
        <Typography.Paragraph type="secondary">
          {disableTarget
            ? `${fullName(disableTarget)} will lose access and all active sessions will be revoked.`
            : ''}
        </Typography.Paragraph>
        <div className="modal-form-actions">
          <Button onClick={() => setDisableTarget(undefined)}>Cancel</Button>
          <Button
            danger
            onClick={async () => {
              if (!disableTarget) return;
              try {
                await apiRequest(
                  `/api/v1/users/${disableTarget.id}/disable`,
                  { method: 'POST' },
                  accessToken,
                );
                setDisableTarget(undefined);
                void message.success('User account disabled.');
                await refresh();
              } catch (error) {
                void message.error(
                  getUserErrorMessage(error, 'User account could not be disabled.'),
                );
              }
              }}
            >
              Disable account
            </Button>
        </div>
      </Modal>

      <Modal
        className="account-confirm-modal"
        footer={null}
        onCancel={() => setActivateTarget(undefined)}
        open={Boolean(activateTarget)}
        title="Activate user account?"
        width={460}
      >
        <Typography.Paragraph type="secondary">
          {activateTarget ? `${fullName(activateTarget)} will be activated and can sign in again.` : ''}
        </Typography.Paragraph>
        <div className="modal-form-actions">
          <Button onClick={() => setActivateTarget(undefined)}>Cancel</Button>
          <Button
            onClick={async () => {
              if (!activateTarget) return;
              try {
                await apiRequest(
                  `/api/v1/users/${activateTarget.id}/activate`,
                  { method: 'POST' },
                  accessToken,
                );
                setActivateTarget(undefined);
                void message.success('User account activated.');
                await refresh();
              } catch (error) {
                void message.error(getUserErrorMessage(error, 'User account could not be activated.'));
              }
            }}
          >
            Activate account
          </Button>
        </div>
      </Modal>

      <Modal
        className="account-confirm-modal"
        footer={null}
        onCancel={() => setDeleteTarget(undefined)}
        open={Boolean(deleteTarget)}
        title="Delete user account?"
        width={460}
      >
        <Typography.Paragraph type="secondary">
          {deleteTarget
            ? `${fullName(deleteTarget)} will be permanently removed. This action cannot be undone.`
            : ''}
        </Typography.Paragraph>
        <div className="modal-form-actions">
          <Button onClick={() => setDeleteTarget(undefined)}>Cancel</Button>
          <Button
            danger
            onClick={async () => {
              if (!deleteTarget) return;
              try {
                await apiRequest(
                  `/api/v1/users/${deleteTarget.id}`,
                  { method: 'DELETE' },
                  accessToken,
                );
                setDeleteTarget(undefined);
                void message.success('User account deleted.');
                await refresh();
              } catch (error) {
                void message.error(getUserErrorMessage(error, 'User account could not be deleted.'));
              }
            }}
          >
            Delete account
          </Button>
        </div>
      </Modal>
    </section>
  );
}
