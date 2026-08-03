import { Alert, Button, Form, Select, Space, Table, Typography, message } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';

import { apiRequest, getUserErrorMessage } from '../api';
import { useAuth } from '../auth';

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
  const { accessToken } = useAuth();
  const client = useQueryClient();
  const members = useQuery({
    enabled: Boolean(projectId),
    queryFn: () =>
      apiRequest<Membership[]>(`/api/v1/projects/${projectId}/members`, {}, accessToken),
    queryKey: ['members', projectId, accessToken],
  });
  const users = useQuery({
    queryFn: () =>
      apiRequest<Array<{ id: string; email: string }>>('/api/v1/users', {}, accessToken),
    queryKey: ['users', accessToken],
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
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>Project members</Typography.Title>
          <Typography.Text type="secondary">
            Assign users to project roles and manage workspace access.
          </Typography.Text>
        </div>
      </div>
      {members.isError || users.isError || roles.isError ? (
        <Alert
          message={getUserErrorMessage(
            members.error ?? users.error ?? roles.error,
            'Project members could not be loaded.',
          )}
          showIcon
          type="error"
        />
      ) : null}
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
            render: (_, row) => (
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
                  options={(roles.data ?? []).map((role) => ({ label: role.name, value: role.id }))}
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
            ),
            title: 'Actions',
          },
        ]}
      />
    </section>
  );
}
