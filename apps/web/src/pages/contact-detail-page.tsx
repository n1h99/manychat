import {
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';

import { apiRequest } from '../api';
import { useAuth } from '../auth';
import { hasProjectPermission, useProjectAccess } from '../project-access';

interface Contact {
  id: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  phone: string | null;
  email: string | null;
  status: 'ACTIVE' | 'BLOCKED' | 'UNSUBSCRIBED' | 'ARCHIVED' | 'MERGED';
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
  const access = useProjectAccess(projectId);
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

  if (!contact.data) return <Spin className="route-loading" />;

  const reload = async () =>
    cache.invalidateQueries({ queryKey: ['contact', projectId, contactId] });
  const value = contact.data;

  return (
    <section>
      <div className="page-heading-row">
        <div>
          <Typography.Text className="header-kicker">Contact profile</Typography.Text>
          <Typography.Title level={2}>{value.displayName}</Typography.Title>
          <Typography.Text type="secondary">
            {value.username
              ? `@${value.username}`
              : value.email || value.phone || 'Customer record'}
          </Typography.Text>
        </div>
        <Space>
          <Tag color={value.status === 'ACTIVE' ? 'green' : 'orange'}>{value.status}</Tag>
          <Tag color={value.automationMode === 'ENABLED' ? 'cyan' : 'default'}>
            Automation {value.automationMode.toLowerCase()}
          </Tag>
        </Space>
      </div>

      <Row className="balanced-card-row" gutter={[18, 18]}>
        <Col lg={9} xs={24}>
          <Card title="Contact summary">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="CRM lead">{value.crmLeadId ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Channel identities">
                {value.channelIdentities.length
                  ? value.channelIdentities.map((identity) => (
                      <div className="identity-row" key={identity.id}>
                        <Tag>{identity.channel}</Tag>
                        <span>
                          {identity.username ? `@${identity.username}` : identity.externalUserId}
                        </span>
                      </div>
                    ))
                  : 'No identities'}
              </Descriptions.Item>
              <Descriptions.Item label="Tags">
                {value.tags.length
                  ? value.tags.map((item) => (
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
                    ))
                  : 'No tags'}
              </Descriptions.Item>
            </Descriptions>
            <Form
              className="contact-tag-form"
              layout="vertical"
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
                  placeholder="Choose a tag"
                />
              </Form.Item>
              <Button block htmlType="submit">
                Add tag
              </Button>
            </Form>
          </Card>
        </Col>
        <Col lg={15} xs={24}>
          <Card title="Contact details">
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
              <Row gutter={14}>
                <Col md={12} xs={24}>
                  <Form.Item label="Display name" name="displayName" rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col md={6} xs={12}>
                  <Form.Item label="First name" name="firstName">
                    <Input />
                  </Form.Item>
                </Col>
                <Col md={6} xs={12}>
                  <Form.Item label="Last name" name="lastName">
                    <Input />
                  </Form.Item>
                </Col>
                <Col md={12} xs={24}>
                  <Form.Item label="Phone" name="phone">
                    <Input />
                  </Form.Item>
                </Col>
                <Col md={12} xs={24}>
                  <Form.Item label="Email" name="email">
                    <Input />
                  </Form.Item>
                </Col>
                <Col md={12} xs={24}>
                  <Form.Item label="Status" name="status">
                    <Select
                      options={[
                        { label: 'Active', value: 'ACTIVE' },
                        { label: 'Blocked', value: 'BLOCKED' },
                        { label: 'Unsubscribed', value: 'UNSUBSCRIBED' },
                        { label: 'Archived', value: 'ARCHIVED' },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col md={12} xs={24}>
                  <Form.Item label="Automation mode" name="automationMode">
                    <Select
                      options={[
                        { label: 'Enabled', value: 'ENABLED' },
                        { label: 'Disabled', value: 'DISABLED' },
                      ]}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Button htmlType="submit" type="primary">
                Save changes
              </Button>
            </Form>
          </Card>
        </Col>
      </Row>

      <Row className="balanced-card-row contact-secondary-row" gutter={[18, 18]}>
        <Col lg={hasProjectPermission(access.data, 'contacts:merge') ? 15 : 24} xs={24}>
          <Card title="Custom field values">
            <Form
              initialValues={{ values: JSON.stringify(value.customFields, null, 2) }}
              layout="vertical"
              onFinish={async (values) => {
                await apiRequest(
                  `/api/v1/projects/${projectId}/contacts/${contactId}`,
                  {
                    body: JSON.stringify({ customFields: JSON.parse(values.values) }),
                    method: 'PATCH',
                  },
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
                <Input.TextArea autoSize={{ minRows: 6 }} />
              </Form.Item>
              <Button htmlType="submit">Save custom fields</Button>
            </Form>
          </Card>
        </Col>
        {hasProjectPermission(access.data, 'contacts:merge') ? (
          <Col lg={9} xs={24}>
            <Card className="danger-card" title="Merge contact">
              <Typography.Paragraph type="secondary">
                Move this record into another contact. This action cannot be undone from the UI.
              </Typography.Paragraph>
              <Form
                layout="vertical"
                onFinish={async (values: { primaryContactId: string }) => {
                  await apiRequest(
                    `/api/v1/projects/${projectId}/contacts/merge`,
                    {
                      body: JSON.stringify({
                        primaryContactId: values.primaryContactId,
                        secondaryContactId: contactId,
                      }),
                      method: 'POST',
                    },
                    accessToken,
                  );
                  window.location.assign(
                    `/projects/${projectId}/contacts/${values.primaryContactId}`,
                  );
                }}
              >
                <Form.Item
                  label="Primary contact ID"
                  name="primaryContactId"
                  rules={[{ required: true }]}
                >
                  <Input />
                </Form.Item>
                <Button block danger htmlType="submit">
                  Merge contacts
                </Button>
              </Form>
            </Card>
          </Col>
        ) : null}
      </Row>
    </section>
  );
}
