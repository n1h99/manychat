import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { ApiError } from '../api';
import { useAuth } from '../auth';

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  return (
    <main className="login-page">
      <Card className="login-card">
        <Typography.Title level={2}>Omnicus</Typography.Title>
        <Typography.Paragraph type="secondary">
          Sign in to the pilot administration console.
        </Typography.Paragraph>
        {error ? <Alert className="form-alert" message={error} type="error" /> : null}
        <Form
          layout="vertical"
          onFinish={async (values: { email: string; password: string }) => {
            setError(undefined);
            setSubmitting(true);
            try {
              await auth.login(values.email, values.password);
              await navigate('/projects');
            } catch (cause) {
              setError(cause instanceof ApiError ? cause.message : 'Unable to sign in');
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <Form.Item label="Email" name="email" rules={[{ required: true, type: 'email' }]}>
            <Input autoComplete="email" />
          </Form.Item>
          <Form.Item label="Password" name="password" rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button block htmlType="submit" loading={submitting} type="primary">
            Sign in
          </Button>
        </Form>
      </Card>
    </main>
  );
}
