import {
  Alert,
  Button,
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
import { MailOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { useState } from 'react';

import { apiRequest, getUserErrorMessage } from '../api';
import { useAuth } from '../auth';
import { hasProjectPermission, useProjectAccess } from '../project-access';

interface Membership {
  id: string;
  projectRole: { id: string; name: string };
  user: { email: string; firstName: string; id: string; lastName: string; status: string };
}
interface ProjectRole {
  id: string;
  name: string;
}

export function MembersPage() {
  const { projectId } = useParams();
  const { accessToken, identity } = useAuth();
  const client = useQueryClient();
  const access = useProjectAccess(projectId);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [secureLink, setSecureLink] = useState<{ expiresAt: string; url: string }>();
  const canManage = hasProjectPermission(access.data, 'members:manage');
  const canReadUsers =
    identity?.globalRoleNames.includes('super-admin') ||
    identity?.globalPermissions.includes('users:read');
  const members = useQuery({
    enabled: Boolean(projectId),
    queryFn: () =>
      apiRequest<Membership[]>(`/api/v1/projects/${projectId}/members`, {}, accessToken),
    queryKey: ['members', projectId, accessToken],
  });
  const users = useQuery({
    enabled: Boolean(canReadUsers),
    queryFn: () =>
      apiRequest<Array<{ id: string; email: string }>>('/api/v1/users', {}, accessToken),
    queryKey: ['users', accessToken],
  });
  const invitations = useQuery({
    enabled: Boolean(projectId && canManage),
    queryFn: () =>
      apiRequest<
        Array<{
          acceptedAt: string | null;
          emailSnapshot: string;
          expiresAt: string;
          id: string;
          projectRole: { name: string };
          revokedAt: string | null;
        }>
      >(`/api/v1/projects/${projectId}/invitations`, {}, accessToken),
    queryKey: ['project-invitations', projectId, accessToken],
  });
  const roles = useQuery({
    enabled: Boolean(projectId),
    queryFn: () =>
      apiRequest<ProjectRole[]>(`/api/v1/projects/${projectId}/roles`, {}, accessToken),
    queryKey: ['roles', projectId, accessToken],
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['members', projectId] });
  return (
    <section>
      <div className="page-heading-row">
        <div>
          <Typography.Title level={2}>Project members</Typography.Title>
          <Typography.Text type="secondary">
            Assign users to project roles and manage workspace access.
          </Typography.Text>
        </div>
        {canManage ? (
          <Button icon={<MailOutlined />} onClick={() => setInviteOpen(true)}>
            Invite by email
          </Button>
        ) : null}
      </div>
      {members.isError || users.isError || roles.isError || invitations.isError ? (
        <Alert
          message={getUserErrorMessage(
            members.error ?? users.error ?? roles.error ?? invitations.error,
            'Project members could not be loaded.',
          )}
          showIcon
          type="error"
        />
      ) : null}
      {canReadUsers && canManage ? (
        <Form
          className="member-create-form surface"
          layout="inline"
          onFinish={async (values) => {
            try {
              await apiRequest(
                `/api/v1/projects/${projectId}/members`,
                { body: JSON.stringify(values), method: 'POST' },
                accessToken,
              );
              await refresh();
              void message.success('Project member added.');
            } catch (error) {
              void message.error(getUserErrorMessage(error, 'Project member could not be added.'));
            }
          }}
        >
          <Form.Item name="userId" rules={[{ required: true }]}>
            <Select
              options={(users.data ?? []).map((user) => ({ label: user.email, value: user.id }))}
              placeholder="User"
              style={{ minWidth: 240 }}
            />
          </Form.Item>
          <Form.Item name="projectRoleId" rules={[{ required: true }]}>
            <Select
              options={(roles.data ?? []).map((role) => ({ label: role.name, value: role.id }))}
              placeholder="Project role"
              style={{ minWidth: 220 }}
            />
          </Form.Item>
          <Button htmlType="submit" type="primary">
            Add member
          </Button>
        </Form>
      ) : null}
      <Table<Membership>
        dataSource={members.data ?? []}
        loading={members.isLoading}
        pagination={false}
        rowKey="id"
        columns={[
          { render: (_, row) => `${row.user.firstName} ${row.user.lastName}`, title: 'Member' },
          { dataIndex: ['user', 'email'], title: 'Email' },
          { dataIndex: ['projectRole', 'name'], title: 'Project role' },
          {
            render: (_, row) =>
              canManage ? (
                <Space>
                  <Select
                    value={row.projectRole.id}
                    onChange={async (projectRoleId) => {
                      try {
                        await apiRequest(
                          `/api/v1/projects/${projectId}/members/${row.id}`,
                          { body: JSON.stringify({ projectRoleId }), method: 'PATCH' },
                          accessToken,
                        );
                        await refresh();
                        void message.success('Member role updated.');
                      } catch (error) {
                        void message.error(
                          getUserErrorMessage(error, 'Member role could not be updated.'),
                        );
                      }
                    }}
                    options={(roles.data ?? []).map((role) => ({
                      label: role.name,
                      value: role.id,
                    }))}
                    style={{ minWidth: 180 }}
                  />
                  <Button
                    danger
                    onClick={async () => {
                      try {
                        await apiRequest(
                          `/api/v1/projects/${projectId}/members/${row.id}`,
                          { method: 'DELETE' },
                          accessToken,
                        );
                        await refresh();
                        void message.success('Project member removed.');
                      } catch (error) {
                        void message.error(
                          getUserErrorMessage(error, 'Project member could not be removed.'),
                        );
                      }
                    }}
                  >
                    Remove
                  </Button>
                </Space>
              ) : null,
            title: 'Actions',
          },
        ]}
      />
      {canManage ? (
        <div className="member-invitations surface">
          <Typography.Title level={4}>Pending and recent invitations</Typography.Title>
          <Table
            dataSource={invitations.data ?? []}
            pagination={{ hideOnSinglePage: true, pageSize: 8 }}
            rowKey="id"
            columns={[
              { dataIndex: 'emailSnapshot', title: 'Email' },
              { dataIndex: ['projectRole', 'name'], title: 'Role' },
              {
                render: (_, row) => {
                  const state = row.acceptedAt
                    ? 'Accepted'
                    : row.revokedAt
                      ? 'Revoked'
                      : new Date(row.expiresAt) <= new Date()
                        ? 'Expired'
                        : 'Active';
                  return (
                    <Tag
                      color={
                        state === 'Active' ? 'blue' : state === 'Accepted' ? 'green' : 'default'
                      }
                    >
                      {state}
                    </Tag>
                  );
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
        destroyOnHidden
        footer={null}
        onCancel={() => setInviteOpen(false)}
        open={inviteOpen}
        title="Invite project member"
      >
        <Form
          layout="vertical"
          onFinish={async (values: { email: string; projectRoleId: string }) => {
            try {
              const result = await apiRequest<{ expiresAt: string; invitationUrl: string }>(
                `/api/v1/projects/${projectId}/invitations`,
                { body: JSON.stringify(values), method: 'POST' },
                accessToken,
              );
              setInviteOpen(false);
              setSecureLink({ expiresAt: result.expiresAt, url: result.invitationUrl });
              await client.invalidateQueries({ queryKey: ['project-invitations', projectId] });
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
          <Form.Item label="Project role" name="projectRoleId" rules={[{ required: true }]}>
            <Select fieldNames={{ label: 'name', value: 'id' }} options={roles.data ?? []} />
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
        title="One-time invitation link"
      >
        <Alert
          className="form-alert"
          description={`Share through a trusted channel. This link expires ${secureLink ? new Date(secureLink.expiresAt).toLocaleString() : ''}.`}
          message="The link is shown once"
          showIcon
          type="warning"
        />
        <Input.TextArea readOnly autoSize={{ minRows: 3, maxRows: 5 }} value={secureLink?.url} />
        <Button
          className="secure-link-copy"
          onClick={async () => {
            if (!secureLink) return;
            await navigator.clipboard.writeText(secureLink.url);
            void message.success('Invitation link copied.');
          }}
          type="primary"
        >
          Copy link
        </Button>
      </Modal>
    </section>
  );
}
