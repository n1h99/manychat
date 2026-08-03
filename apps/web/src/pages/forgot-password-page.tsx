import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router';

import { apiRequest, getUserErrorMessage } from '../api';

export function ForgotPasswordPage() {
  const [error, setError] = useState<string>();
  const [submitted, setSubmitted] = useState(false);
  return (
    <main className="login-page">
      <Card className="login-card account-link-card">
        <div className="login-brand">
          <span className="brand-mark">OM</span>
          <Typography.Title level={2}>Reset your password</Typography.Title>
          <Typography.Paragraph type="secondary">
            Send a secure request to an Omnicus administrator. The administrator can generate a
            one-time reset link without seeing your password.
          </Typography.Paragraph>
        </div>
        {error ? <Alert className="form-alert" message={error} showIcon type="error" /> : null}
        {submitted ? (
          <Alert
            className="form-alert"
            description="If the account is active, the request is now visible to an administrator."
            message="Request received"
            showIcon
            type="success"
          />
        ) : (
          <Form
            layout="vertical"
            onFinish={async ({ email }: { email: string }) => {
              setError(undefined);
              try {
                await apiRequest('/api/v1/auth/forgot-password', {
                  body: JSON.stringify({ email }),
                  method: 'POST',
                });
                setSubmitted(true);
              } catch (cause) {
                setError(getUserErrorMessage(cause, 'The reset request could not be sent.'));
              }
            }}
          >
            <Form.Item label="Email" name="email" rules={[{ required: true, type: 'email' }]}>
              <Input autoComplete="email" />
            </Form.Item>
            <Button block htmlType="submit" type="primary">
              Request reset link
            </Button>
          </Form>
        )}
        <Link className="account-link-back" to="/login">
          Back to sign in
        </Link>
      </Card>
    </main>
  );
}
