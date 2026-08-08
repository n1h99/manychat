import { SettingOutlined, UserOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input, Modal, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiRequest, getUserErrorMessage } from './api';
import { useAuth } from './auth';

interface AccountProfile {
  email: string;
  firstName: string;
  lastName: string;
}

interface ProfileFormValues extends AccountProfile {
  newPassword?: string;
}

export function ProfileSettingsModal({ onClose, open }: { onClose(): void; open: boolean }) {
  const { accessToken, refresh } = useAuth();
  const [form] = Form.useForm<ProfileFormValues>();
  const [saving, setSaving] = useState(false);
  const profile = useQuery({
    enabled: open,
    queryFn: () => apiRequest<AccountProfile>('/api/v1/users/me', {}, accessToken),
    queryKey: ['account-profile', accessToken],
  });

  useEffect(() => {
    if (!profile.data) return;
    form.resetFields();
    form.setFieldsValue(profile.data);
  }, [form, profile.data]);

  const close = () => {
    form.resetFields();
    onClose();
  };

  return (
    <Modal
      className="account-profile-modal"
      destroyOnHidden
      footer={null}
      onCancel={close}
      open={open}
      width={700}
    >
      <div className="modal-title-block">
        <span className="modal-title-icon">
          <SettingOutlined />
        </span>
        <div>
          <Typography.Title level={3}>Profile settings</Typography.Title>
          <Typography.Text type="secondary">Manage your account details.</Typography.Text>
        </div>
      </div>
      {profile.isError ? (
        <Alert
          className="form-alert"
          message={getUserErrorMessage(profile.error, 'Profile settings could not be loaded.')}
          showIcon
          type="error"
        />
      ) : null}
      <Form<ProfileFormValues>
        form={form}
        layout="vertical"
        onFinish={async (values) => {
          const payload = {
            email: values.email,
            firstName: values.firstName,
            lastName: values.lastName,
            ...(values.newPassword ? { newPassword: values.newPassword } : {}),
          };
          setSaving(true);
          try {
            await apiRequest(
              '/api/v1/users/me',
              { body: JSON.stringify(payload), method: 'PATCH' },
              accessToken,
            );
            await refresh();
            void message.success('Profile settings saved.');
            close();
          } catch (error) {
            void message.error(getUserErrorMessage(error, 'Profile settings could not be saved.'));
          } finally {
            setSaving(false);
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
            extra="Leave empty to keep your current password."
            label="New password"
            name="newPassword"
            rules={[{ min: 12 }]}
          >
            <Input.Password
              autoComplete="new-password"
              placeholder="Enter at least 12 characters"
            />
          </Form.Item>
        </section>

        <div className="modal-form-actions">
          <Button onClick={close}>Cancel</Button>
          <Button disabled={profile.isError} htmlType="submit" loading={saving} type="primary">
            Save changes
          </Button>
        </div>
      </Form>
    </Modal>
  );
}
