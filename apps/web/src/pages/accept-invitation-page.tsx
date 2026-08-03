import { Alert, Button, Card, Form, Input, Spin, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';

import { apiRequest, getUserErrorMessage } from '../api';

interface InvitationPreview {
  email: string;
  expiresAt: string;
  projectName?: string;
  roleName: string;
  scope: 'GLOBAL' | 'PROJECT';
}

export function AcceptInvitationPage() {
  const location = useLocation();
  const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string>();
  const preview = useQuery({
    enabled: Boolean(token),
    queryFn: () =>
      apiRequest<InvitationPreview>('/api/v1/auth/invitations/preview', {
        body: JSON.stringify({ token }),
        method: 'POST',
      }),
    queryKey: ['invitation-preview', token],
    retry: false,
  });
  const data = preview.data;
  return (
    <main className="login-page">
      <Card className="login-card account-link-card">
        <div className="login-brand">
          <span className="brand-mark">OM</span>
          <Typography.Title level={2}>Accept invitation</Typography.Title>
        </div>
        {!token || preview.isError ? (
          <Alert message="This invitation is invalid or expired" showIcon type="error" />
        ) : preview.isLoading ? (
          <Spin />
        ) : completed ? (
          <Alert
            description={<Link to="/login">Continue to sign in</Link>}
            message="Invitation accepted"
            showIcon
            type="success"
          />
        ) : (
          <>
            <div className="invitation-summary">
              <strong>{data?.projectName ?? 'Omnicus system access'}</strong>
              <span>{data?.roleName}</span>
              <small>{data?.email}</small>
            </div>
            {error ? <Alert className="form-alert" message={error} showIcon type="error" /> : null}
            <Form
              layout="vertical"
              onFinish={async (values: {
                firstName?: string;
                lastName?: string;
                password: string;
              }) => {
                setError(undefined);
                try {
                  await apiRequest('/api/v1/auth/invitations/accept', {
                    body: JSON.stringify({ ...values, token }),
                    method: 'POST',
                  });
                  setCompleted(true);
                } catch (cause) {
                  setError(getUserErrorMessage(cause, 'The invitation could not be accepted.'));
                }
              }}
            >
              <Alert
                className="form-alert"
                description="For an existing Omnicus account, enter its current password and leave the profile fields empty. For a new account, enter your name and create a password."
                message="Secure account confirmation"
                showIcon
                type="info"
              />
              <div className="account-form-grid account-form-grid--two">
                <Form.Item label="First name (new accounts)" name="firstName">
                  <Input autoComplete="given-name" />
                </Form.Item>
                <Form.Item label="Last name (new accounts)" name="lastName">
                  <Input autoComplete="family-name" />
                </Form.Item>
              </div>
              <Form.Item
                extra="Current password for an existing account; a new password for a new account."
                label="Password"
                name="password"
                rules={[{ min: 12, required: true }]}
              >
                <Input.Password autoComplete="current-password" />
              </Form.Item>
              <Button block htmlType="submit" type="primary">
                Accept invitation
              </Button>
            </Form>
          </>
        )}
      </Card>
    </main>
  );
}
