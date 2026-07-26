import { Button, Descriptions, Form, Input, Select, Space, Spin, Tag, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';

import { apiRequest } from '../api';
import { useAuth } from '../auth';

interface Contact {
  id: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  phone: string | null;
  email: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  automationMode: 'ENABLED' | 'DISABLED';
  crmLeadId: string | null;
  crmContactId: string | null;
  customFields: Record<string, unknown>;
  channelIdentities: {
    id: string;
    channel: string;
    externalUserId: string;
    username: string | null;
  }[];
  tags: { tag: { id: string; name: string; color: string | null } }[];
}
interface TagItem {
  id: string;
  name: string;
  color: string | null;
}

export function ContactDetailPage() {
  const { contactId, projectId } = useParams();
  const { accessToken } = useAuth();
  const cache = useQueryClient();
  const contact = useQuery({
    enabled: Boolean(projectId && contactId),
    queryFn: () =>
      apiRequest<Contact>(`/api/v1/projects/${projectId}/contacts/${contactId}`, {}, accessToken),
    queryKey: ['contact', projectId, contactId, accessToken],
  });
  const tags = useQuery({
    enabled: Boolean(projectId),
    queryFn: () => apiRequest<TagItem[]>(`/api/v1/projects/${projectId}/tags`, {}, accessToken),
    queryKey: ['tags', projectId, accessToken],
  });
  if (!contact.data) return <Spin />;
  const reload = async () =>
    cache.invalidateQueries({ queryKey: ['contact', projectId, contactId] });
  const value = contact.data;
  return (
    <section>
      <Space className="page-heading" direction="vertical" size={0}>
        <Typography.Title level={2}>{value.displayName}</Typography.Title>
        <Typography.Text type="secondary">Contact card</Typography.Text>
      </Space>
      <Descriptions bordered column={1}>
        <Descriptions.Item label="Status">
          <Tag>{value.status}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Automation">
          <Tag>{value.automationMode}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="CRM lead">{value.crmLeadId ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="Identities">
          {value.channelIdentities.map((identity) => (
            <div key={identity.id}>
              {identity.channel}: {identity.externalUserId}
            </div>
          ))}
        </Descriptions.Item>
        <Descriptions.Item label="Tags">
          {value.tags.map((item) => (
            <Tag
              closable
              {...(item.tag.color ? { color: item.tag.color } : {})}
              key={item.tag.id}
              onClose={() =>
                void apiRequest(
                  `/api/v1/projects/${projectId}/contacts/${contactId}/tags/${item.tag.id}`,
                  { method: 'DELETE' },
                  accessToken,
                ).then(reload)
              }
            >
              {item.tag.name}
            </Tag>
          ))}
        </Descriptions.Item>
      </Descriptions>
      <Form
        initialValues={value}
        layout="vertical"
        onFinish={async (values) => {
          await apiRequest(
            `/api/v1/projects/${projectId}/contacts/${contactId}`,
            { body: JSON.stringify(values), method: 'PATCH' },
            accessToken,
          );
          await reload();
        }}
      >
        <Typography.Title level={4}>Edit contact</Typography.Title>
        <Form.Item label="Display name" name="displayName" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="First name" name="firstName">
          <Input />
        </Form.Item>
        <Form.Item label="Last name" name="lastName">
          <Input />
        </Form.Item>
        <Form.Item label="Phone" name="phone">
          <Input />
        </Form.Item>
        <Form.Item label="Email" name="email">
          <Input />
        </Form.Item>
        <Form.Item label="Status" name="status">
          <Select options={[{ value: 'ACTIVE' }, { value: 'ARCHIVED' }]} />
        </Form.Item>
        <Form.Item label="Automation mode" name="automationMode">
          <Select options={[{ value: 'ENABLED' }, { value: 'DISABLED' }]} />
        </Form.Item>
        <Button htmlType="submit" type="primary">
          Save changes
        </Button>
      </Form>
      <Form
        layout="inline"
        onFinish={async (values) => {
          await apiRequest(
            `/api/v1/projects/${projectId}/contacts/${contactId}/tags`,
            { body: JSON.stringify(values), method: 'POST' },
            accessToken,
          );
          await reload();
        }}
      >
        <Form.Item label="Add tag" name="tagId">
          <Select
            options={(tags.data ?? []).map((tag) => ({ label: tag.name, value: tag.id }))}
            style={{ minWidth: 180 }}
          />
        </Form.Item>
        <Button htmlType="submit">Add</Button>
      </Form>
      <Typography.Title level={4}>Custom field values</Typography.Title>
      <Form
        initialValues={{ values: JSON.stringify(value.customFields, null, 2) }}
        layout="vertical"
        onFinish={async (values) => {
          await apiRequest(
            `/api/v1/projects/${projectId}/contacts/${contactId}`,
            { body: JSON.stringify({ customFields: JSON.parse(values.values) }), method: 'PATCH' },
            accessToken,
          );
          await reload();
        }}
      >
        <Form.Item
          extra="Keys and values are validated against active definitions."
          label="Values (JSON)"
          name="values"
          rules={[{ required: true }]}
        >
          <Input.TextArea autoSize={{ minRows: 4 }} />
        </Form.Item>
        <Button htmlType="submit">Save custom fields</Button>
      </Form>
    </section>
  );
}
