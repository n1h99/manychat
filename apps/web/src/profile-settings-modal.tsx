import { EnvironmentOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons';
import { Button, Form, Input, Modal, Typography, message } from 'antd';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiRequest } from './api';
import { useAuth } from './auth';

interface AccountProfile {
  city: string | null;
  country: string | null;
  email: string;
  firstName: string;
  lastName: string;
  region: string | null;
}

interface ProfileFormValues extends AccountProfile {
  newPassword?: string;
}

export function ProfileSettingsModal({ onClose, open }: { onClose(): void; open: boolean }) {
  const { accessToken, refresh } = useAuth();
  const [form] = Form.useForm<ProfileFormValues>();
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
          <Typography.Text type="secondary">
            Manage your account details and location.
          </Typography.Text>
        </div>
      </div>
      <Form<ProfileFormValues>
        form={form}
        layout="vertical"
        onFinish={async (values) => {
          const payload = {
            city: values.city ?? '',
            country: values.country ?? '',
            email: values.email,
            firstName: values.firstName,
            lastName: values.lastName,
            ...(values.newPassword ? { newPassword: values.newPassword } : {}),
            region: values.region ?? '',
          };
          try {
            await apiRequest(
              '/api/v1/users/me',
              { body: JSON.stringify(payload), method: 'PATCH' },
              accessToken,
            );
            await refresh();
            void message.success('Profile settings saved.');
            close();
          } catch {
            void message.error('Profile settings could not be saved.');
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
          <Button onClick={close}>Cancel</Button>
          <Button htmlType="submit" loading={profile.isLoading} type="primary">
            Save changes
          </Button>
        </div>
      </Form>
    </Modal>
  );
}
