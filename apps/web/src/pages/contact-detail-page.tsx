import {
  Alert,
  Button,
  Card,
  Col,
  Modal,
  Form,
  Input,
  Row,
  Select,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';

import { apiRequest, getUserErrorMessage } from '../api';
import { useAuth } from '../auth';
import { hasProjectPermission, useProjectAccess } from '../project-access';
import { StatusText } from '../status-text';
import type { Project } from './projects-page';

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

interface ContactSettingsLocale {
  primaryContactIdLabel: string;
  mergeInstruction: string;
  mergeButtonLabel: string;
  deleteInstruction: string;
  deleteButtonLabel: string;
}

const CONTACT_SETTINGS_LOCALE_MAP: Record<'en' | 'ru', ContactSettingsLocale> = {
  en: {
    primaryContactIdLabel: 'Primary contact ID',
    mergeInstruction:
      'Move this record into another contact. This action cannot be undone from the UI.',
    mergeButtonLabel: 'Merge contacts',
    deleteInstruction:
      'Delete this contact from the project. This action cannot be undone from the UI.',
    deleteButtonLabel: 'Delete contact',
  },
  ru: {
    primaryContactIdLabel:
      '\u041e\u0441\u043d\u043e\u0432\u043d\u043e\u0439 \u0438\u0434\u0435\u043d\u0442\u0438\u0444\u0438\u043a\u0430\u0442\u043e\u0440 \u043a\u043e\u043d\u0442\u0430\u043a\u0442\u0430',
    mergeInstruction:
      '\u041f\u0435\u0440\u0435\u043d\u0435\u0441\u0438\u0442\u0435 \u044d\u0442\u0443 \u0437\u0430\u043f\u0438\u0441\u044c \u0432 \u0434\u0440\u0443\u0433\u043e\u0439 \u043a\u043e\u043d\u0442\u0430\u043a\u0442. \u042d\u0442\u043e \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043d\u0435\u043b\u044c\u0437\u044f \u043e\u0442\u043c\u0435\u043d\u0438\u0442\u044c \u0438\u0437 \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c\u0441\u043a\u043e\u0433\u043e \u0438\u043d\u0442\u0435\u0440\u0444\u0435\u0439\u0441\u0430.',
    mergeButtonLabel:
      '\u041e\u0431\u044a\u0435\u0434\u0438\u043d\u0438\u0442\u044c \u043a\u043e\u043d\u0442\u0430\u043a\u0442\u044b',
    deleteInstruction:
      '\u0423\u0434\u0430\u043b\u0438\u0442\u0435 \u044d\u0442\u043e\u0442 \u043a\u043e\u043d\u0442\u0430\u043a\u0442 \u0438\u0437 \u043f\u0440\u043e\u0435\u043a\u0442\u0430. \u042d\u0442\u043e \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043d\u0435\u043b\u044c\u0437\u044f \u043e\u0442\u043c\u0435\u043d\u0438\u0442\u044c \u0438\u0437 \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c\u0441\u043a\u043e\u0433\u043e \u0438\u043d\u0442\u0435\u0440\u0444\u0435\u0439\u0441\u0430.',
    deleteButtonLabel:
      '\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u043a\u043e\u043d\u0442\u0430\u043a\u0442',
  },
};
function contactSettingsLocale(locale: string | undefined): ContactSettingsLocale {
  const normalizedLocale = locale?.trim().toLowerCase();
  return normalizedLocale?.startsWith('ru')
    ? CONTACT_SETTINGS_LOCALE_MAP.ru
    : CONTACT_SETTINGS_LOCALE_MAP.en;
}

function formatIdentityValue(identity: Contact['channelIdentities'][number]): string {
  return identity.username ? `@${identity.username}` : (identity.externalUserId ?? '\u2014');
}

export function ContactDetailPage() {
  const { contactId, projectId } = useParams();
  const { accessToken } = useAuth();
  const cache = useQueryClient();
  const access = useProjectAccess(projectId);
  const project = useQuery({
    enabled: Boolean(projectId && accessToken),
    queryFn: () => apiRequest<Project>(`/api/v1/projects/${projectId}`, {}, accessToken),
    queryKey: ['project-locale', projectId, accessToken],
  });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingContact, setDeletingContact] = useState(false);
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

  if (contact.isLoading) return <Spin className="route-loading" />;
  if (contact.isError || !contact.data)
    return (
      <Alert
        message={getUserErrorMessage(contact.error, 'Contact could not be loaded.')}
        showIcon
        type="error"
      />
    );

  const reload = async () =>
    cache.invalidateQueries({ queryKey: ['contact', projectId, contactId] });
  const value = contact.data;
  const localeCopy = contactSettingsLocale(project.data?.locale);
  const canUpdate = hasProjectPermission(access.data, 'contacts:update');
  const telegramIdentity = value.channelIdentities.find(
    (identity) => identity.channel.toLowerCase() === 'telegram',
  );
  const deleteContact = async () => {
    try {
      await apiRequest(
        `/api/v1/projects/${projectId}/contacts/${contactId}`,
        { body: JSON.stringify({ status: 'ARCHIVED' }), method: 'PATCH' },
        accessToken,
      );
      void message.success('Contact deleted.');
      window.location.assign(`/projects/${projectId}/contacts`);
    } catch (error) {
      void message.error(getUserErrorMessage(error, 'Contact could not be deleted.'));
    }
  };

  return (
    <section>
      <div className="entity-hero">
        <div className="entity-hero-copy">
          <Typography.Title level={2}>{value.displayName}</Typography.Title>
          <Typography.Text type="secondary">
            {value.username
              ? `@${value.username}`
              : value.email || value.phone || 'Customer record'}
          </Typography.Text>
        </div>
      </div>

      <Row className="balanced-card-row" gutter={[18, 18]}>
        <Col lg={9} xs={24}>
          <Card className="contact-summary-card" title="Contact summary">
            <div className="contact-summary-main">
              <div className="contact-summary-grid">
                <div className="contact-summary-row">
                  <div className="contact-summary-label">CRM lead:</div>
                  <div className="contact-summary-value">{value.crmLeadId ?? '\u2014'}</div>
                </div>
                <div className="contact-summary-row">
                  <div className="contact-summary-label">Telegram:</div>
                  <div className="contact-summary-value">
                    {telegramIdentity ? formatIdentityValue(telegramIdentity) : '\u2014'}
                  </div>
                </div>
                <div className="contact-summary-row">
                  <div className="contact-summary-label">Status:</div>
                  <div className="contact-summary-value">
                    <StatusText status={value.status} />
                  </div>
                </div>
                <div className="contact-summary-row">
                  <div className="contact-summary-label">Automation:</div>
                  <div className="contact-summary-value">
                    <StatusText status={value.automationMode} />
                  </div>
                </div>
                <div className="contact-summary-row">
                  <div className="contact-summary-label">Tags:</div>
                  <div className="contact-summary-value contact-summary-tags">
                    {value.tags.length
                      ? value.tags.map((item) => (
                          <Tag
                            closable={canUpdate}
                            {...(item.tag.color ? { color: item.tag.color } : {})}
                            key={item.tag.id}
                            onClose={(event) => {
                              event.preventDefault();
                              void (async () => {
                                try {
                                  await apiRequest(
                                    `/api/v1/projects/${projectId}/contacts/${contactId}/tags/${item.tag.id}`,
                                    { method: 'DELETE' },
                                    accessToken,
                                  );
                                  await reload();
                                  void message.success('Tag removed from contact.');
                                } catch (error) {
                                  void message.error(
                                    getUserErrorMessage(
                                      error,
                                      'Tag could not be removed from contact.',
                                    ),
                                  );
                                }
                              })();
                            }}
                          >
                            {item.tag.name}
                          </Tag>
                        ))
                      : 'No tags'}
                  </div>
                </div>
              </div>
            </div>
            <div className="contact-summary-actions">
              <Form
                className="contact-tag-form"
                layout="vertical"
                onFinish={async (values) => {
                  try {
                    await apiRequest(
                      `/api/v1/projects/${projectId}/contacts/${contactId}/tags`,
                      { body: JSON.stringify(values), method: 'POST' },
                      accessToken,
                    );
                    await reload();
                    void message.success('Tag added to contact.');
                  } catch (error) {
                    void message.error(
                      getUserErrorMessage(error, 'Tag could not be added to contact.'),
                    );
                  }
                }}
              >
                <Form.Item label="Add tag" name="tagId">
                  <Select
                    className="contact-tag-select"
                    options={(tags.data ?? []).map((tag) => ({ label: tag.name, value: tag.id }))}
                    placeholder="Choose a tag"
                  />
                </Form.Item>
                <Button block className="contact-tag-button" htmlType="submit">
                  Add tag
                </Button>
              </Form>
            </div>
          </Card>
        </Col>
        <Col lg={15} xs={24}>
          <Card title="Contact details">
            <Form
              initialValues={value}
              layout="vertical"
              onFinish={async (values) => {
                try {
                  await apiRequest(
                    `/api/v1/projects/${projectId}/contacts/${contactId}`,
                    { body: JSON.stringify(values), method: 'PATCH' },
                    accessToken,
                  );
                  await reload();
                  void message.success('Contact saved.');
                } catch (error) {
                  void message.error(getUserErrorMessage(error, 'Contact could not be saved.'));
                }
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
                let customFields: Record<string, unknown>;
                try {
                  customFields = JSON.parse(values.values) as Record<string, unknown>;
                } catch {
                  void message.error(
                    'Custom fields could not be saved. Values are not valid JSON.',
                  );
                  return;
                }
                try {
                  await apiRequest(
                    `/api/v1/projects/${projectId}/contacts/${contactId}`,
                    {
                      body: JSON.stringify({ customFields }),
                      method: 'PATCH',
                    },
                    accessToken,
                  );
                  await reload();
                  void message.success('Custom fields saved.');
                } catch (error) {
                  void message.error(
                    getUserErrorMessage(error, 'Custom fields could not be saved.'),
                  );
                }
              }}
            >
              <Form.Item
                className="contact-custom-fields-note"
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
            <Card className="danger-card" title="Contact Settings">
              <Form
                layout="vertical"
                onFinish={async (values: { primaryContactId: string }) => {
                  try {
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
                  } catch (error) {
                    void message.error(getUserErrorMessage(error, 'Contacts could not be merged.'));
                  }
                }}
              >
                <Form.Item
                  label={localeCopy.primaryContactIdLabel}
                  name="primaryContactId"
                  rules={[{ required: true }]}
                >
                  <Input />
                </Form.Item>
                <div className="contact-settings-actions">
                  <div className="contact-settings-action-group">
                    <Typography.Paragraph className="contact-settings-note" type="secondary">
                      {localeCopy.mergeInstruction}
                    </Typography.Paragraph>
                    <Button block danger htmlType="submit">
                      {localeCopy.mergeButtonLabel}
                    </Button>
                  </div>
                  <div className="contact-settings-action-group">
                    <Typography.Paragraph className="contact-settings-note" type="secondary">
                      {localeCopy.deleteInstruction}
                    </Typography.Paragraph>
                    <Button block danger onClick={() => setDeleteOpen(true)}>
                      {localeCopy.deleteButtonLabel}
                    </Button>
                  </div>
                </div>
              </Form>
            </Card>
          </Col>
        ) : null}
      </Row>

      <Modal
        className="account-confirm-modal"
        footer={null}
        onCancel={() => setDeleteOpen(false)}
        open={deleteOpen}
        title="Delete this contact?"
        width={460}
      >
        <Typography.Paragraph type="secondary">
          This contact will be archived and removed from active contact lists.
        </Typography.Paragraph>
        <div className="modal-form-actions">
          <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button
            danger
            loading={deletingContact}
            onClick={async () => {
              setDeletingContact(true);
              try {
                await deleteContact();
                setDeleteOpen(false);
              } finally {
                setDeletingContact(false);
              }
            }}
          >
            {localeCopy.deleteButtonLabel}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
