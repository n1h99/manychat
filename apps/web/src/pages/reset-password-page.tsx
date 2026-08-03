import { Alert, Button, Card, Form, Input, Spin, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';

import { apiRequest, getUserErrorMessage } from '../api';

interface ResetPreview {
  email: string;
  expiresAt: string;
}

export function ResetPasswordPage() {
  const location = useLocation();
  const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string>();
  const preview = useQuery({
    enabled: Boolean(token),
    queryFn: () =>
      apiRequest<ResetPreview>('/api/v1/auth/password-reset/preview', {
        body: JSON.stringify({ token }),
        method: 'POST',
      }),
    queryKey: ['password-reset-preview', token],
    retry: false,
  });
  return (
    <main className="login-page">
      <Card className="login-card account-link-card">
        <div className="login-brand">
          <span className="brand-mark">OM</span>
          <Typography.Title level={2}>Choose a new password</Typography.Title>
        </div>
        {!token || preview.isError ? (
          <Alert
            description="Ask an administrator to create a new one-time reset link."
            message="This reset link is invalid or expired"
            showIcon
            type="error"
          />
        ) : preview.isLoading ? (
          <Spin />
        ) : completed ? (
          <Alert
            description={<Link to="/login">Sign in with your new password</Link>}
            message="Password changed"
            showIcon
            type="success"
          />
        ) : (
          <>
            <Typography.Paragraph type="secondary">
              Resetting access for {preview.data?.email}. The link expires at{' '}
              {preview.data ? new Date(preview.data.expiresAt).toLocaleString() : '—'}.
            </Typography.Paragraph>
            {error ? <Alert className="form-alert" message={error} showIcon type="error" /> : null}
            <Form
              layout="vertical"
              onFinish={async ({ password }: { password: string }) => {
                setError(undefined);
                try {
                  await apiRequest('/api/v1/auth/reset-password', {
                    body: JSON.stringify({ password, token }),
                    method: 'POST',
                  });
                  setCompleted(true);
                } catch (cause) {
                  setError(getUserErrorMessage(cause, 'The password could not be changed.'));
                }
              }}
            >
              <Form.Item label="New password" name="password" rules={[{ min: 12, required: true }]}>
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item
                dependencies={['password']}
                label="Confirm password"
                name="confirmation"
                rules={[
                  { required: true },
                  ({ getFieldValue }) => ({
                    validator: (_, value) =>
                      value === getFieldValue('password')
                        ? Promise.resolve()
                        : Promise.reject(new Error('Passwords do not match')),
                  }),
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Button block htmlType="submit" type="primary">
                Change password
              </Button>
            </Form>
          </>
        )}
      </Card>
    </main>
  );
}
