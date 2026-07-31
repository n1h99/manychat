import {
  ApiOutlined,
  DeleteOutlined,
  KeyOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { useRef } from 'react';
import { useParams } from 'react-router';

import {
  type ChannelInboundEvent,
  type ChannelOutboundEvent,
  useChannel,
  useChannelIdentities,
  useChannelInboundEvents,
  useChannelMutations,
  useChannelOutboundEvents,
} from '../channels-api';
import { hasProjectPermission, useProjectAccess } from '../project-access';

function idempotencyKey() {
  return crypto.randomUUID();
}

function connectionStatusColor(status: string) {
  if (status === 'ACTIVE') return 'green';
  if (status === 'ERROR') return 'red';
  if (status === 'DISABLED') return 'default';
  return 'blue';
}

export function ChannelDetailPage() {
  const { projectId, connectionId } = useParams();
  const channel = useChannel(projectId, connectionId);
  const inbound = useChannelInboundEvents(projectId, connectionId);
  const outbound = useChannelOutboundEvents(projectId, connectionId);
  const mutations = useChannelMutations(projectId);
  const access = useProjectAccess(projectId);
  const canManage = hasProjectPermission(access.data, 'channels:manage');
  const identities = useChannelIdentities(projectId, canManage ? connectionId : undefined);
  const retryKey = useRef<string | undefined>(undefined);

  if (channel.isLoading) return <Spin className="route-loading" />;
  if (!channel.data) {
    return <Alert message="Channel was not found." showIcon type="error" />;
  }

  const connection = channel.data;
  const canRotateSecrets = hasProjectPermission(access.data, 'channels:rotate_secrets');
  const action = async (operation: () => Promise<unknown>, successMessage: string) => {
    try {
      await operation();
      void message.success(successMessage);
    } catch {
      void message.error('The operation failed. Check the connection status and try again.');
    }
  };

  return (
    <section>
      <div className="entity-hero channel-entity-hero">
        <div className="entity-hero-copy">
          <Typography.Title level={2}>{connection.name}</Typography.Title>
          <Typography.Text type="secondary">
            {connection.botUsername
              ? `@${connection.botUsername}`
              : 'Bot details are not available'}
          </Typography.Text>
        </div>
        <div className="entity-hero-statuses">
          <Tag className="entity-status-tag" color={connectionStatusColor(connection.status)}>
            {connection.status}
          </Tag>
          <Tag className="entity-status-tag">Webhook: {connection.webhookStatus}</Tag>
        </div>
      </div>

      <Card className="channel-overview-card" title="Connection overview">
        <Descriptions
          column={{ lg: 3, md: 2, xs: 1 }}
          items={[
            { children: connection.type, key: 'type', label: 'Type' },
            {
              children: (
                <Tag color={connectionStatusColor(connection.status)}>{connection.status}</Tag>
              ),
              key: 'status',
              label: 'Status',
            },
            {
              children: connection.botUsername ? `@${connection.botUsername}` : '—',
              key: 'bot',
              label: 'Bot',
            },
            {
              children: connection.externalBotId ?? '—',
              key: 'external-id',
              label: 'External bot ID',
            },
            {
              children: connection.maskedToken ?? '—',
              key: 'token',
              label: 'Token',
            },
            {
              children: connection.webhookStatus,
              key: 'webhook',
              label: 'Webhook',
            },
            {
              children: connection.lastWebhookAt
                ? new Date(connection.lastWebhookAt).toLocaleString()
                : '—',
              key: 'last-webhook',
              label: 'Last webhook',
            },
            {
              children: connection.lastErrorAt
                ? new Date(connection.lastErrorAt).toLocaleString()
                : '—',
              key: 'last-error',
              label: 'Last error',
            },
            {
              children: new Date(connection.updatedAt).toLocaleString(),
              key: 'updated',
              label: 'Updated',
            },
          ]}
          size="small"
        />
      </Card>

      {canManage ? (
        <div className="channel-management-grid">
          <div className="channel-management-stack">
            <Card title="Replace bot token">
              <Typography.Paragraph type="secondary">
                The full token is validated, encrypted and never shown again.
              </Typography.Paragraph>
              <Form
                layout="vertical"
                onFinish={async (values: { botToken: string }) => {
                  await action(
                    () =>
                      mutations.update.mutateAsync({
                        botToken: values.botToken,
                        id: connection.id,
                      }),
                    'Bot token replaced.',
                  );
                }}
              >
                <Form.Item label="New bot token" name="botToken" rules={[{ required: true }]}>
                  <Input.Password autoComplete="new-password" />
                </Form.Item>
                <Button block htmlType="submit">
                  Replace token
                </Button>
              </Form>
            </Card>
            <Card className="channel-actions-card" title="Connection actions">
              <div className="channel-actions">
                {connection.status !== 'ACTIVE' && connection.webhookStatus !== 'CONNECTED' ? (
                  <Button
                    block
                    className="channel-primary-action"
                    icon={<ApiOutlined />}
                    onClick={() =>
                      void action(
                        () => mutations.connect.mutateAsync(connection.id),
                        'Webhook connected.',
                      )
                    }
                    type="primary"
                  >
                    Connect webhook
                  </Button>
                ) : null}
                <Button
                  block
                  icon={<SafetyCertificateOutlined />}
                  onClick={() =>
                    void action(
                      () => mutations.test.mutateAsync(connection.id),
                      'Connection verified.',
                    )
                  }
                >
                  Test connection
                </Button>
                {canRotateSecrets ? (
                  <Button
                    block
                    icon={<KeyOutlined />}
                    onClick={() =>
                      Modal.confirm({
                        centered: true,
                        content: 'The previous webhook secret will stop working after rotation.',
                        onOk: () =>
                          action(
                            () => mutations.rotate.mutateAsync(connection.id),
                            'Webhook secret rotated.',
                          ),
                        title: 'Rotate webhook secret?',
                      })
                    }
                  >
                    Rotate webhook secret
                  </Button>
                ) : null}
                <Button
                  block
                  className="channel-danger-action"
                  danger
                  disabled={connection.status === 'DISABLED'}
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    Modal.confirm({
                      centered: true,
                      content: 'Existing contacts and message history will not be deleted.',
                      onOk: () =>
                        action(
                          () => mutations.disable.mutateAsync(connection.id),
                          'Channel disabled.',
                        ),
                      title: 'Disable this channel?',
                    })
                  }
                >
                  Disable channel
                </Button>
              </div>
            </Card>
          </div>
          <Card className="channel-test-message-card" title="Send test message">
            <Form
              layout="vertical"
              onFinish={async (values) => {
                retryKey.current ??= idempotencyKey();
                await action(
                  () =>
                    mutations.send.mutateAsync({
                      id: connection.id,
                      ...values,
                      idempotencyKey: retryKey.current!,
                    }),
                  'Message queued for delivery.',
                );
                retryKey.current = undefined;
              }}
            >
              <Form.Item
                label="Telegram contact"
                name="channelIdentityId"
                rules={[{ message: 'Select a Telegram contact', required: true }]}
              >
                <Select
                  allowClear
                  loading={identities.isLoading}
                  notFoundContent={
                    identities.isError
                      ? 'Telegram contacts could not be loaded'
                      : 'This channel has no Telegram contacts yet'
                  }
                  optionFilterProp="label"
                  options={(identities.data ?? []).map((identity) => {
                    const username = identity.username ? `@${identity.username}` : null;
                    return {
                      disabled: identity.status !== 'ACTIVE',
                      label: [
                        identity.contact.displayName,
                        username,
                        identity.status === 'ACTIVE' ? null : `[${identity.status}]`,
                      ]
                        .filter(Boolean)
                        .join(' · '),
                      value: identity.id,
                    };
                  })}
                  placeholder="Choose a recipient"
                  showSearch
                />
              </Form.Item>
              <Form.Item label="Message" name="text" rules={[{ required: true }]}>
                <Input.TextArea autoSize={{ maxRows: 6, minRows: 3 }} />
              </Form.Item>
              <Form.Item
                label="Send without notification"
                name="disableNotification"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Button
                block
                htmlType="submit"
                icon={<SendOutlined />}
                loading={mutations.send.isPending}
                type="primary"
              >
                Queue test message
              </Button>
            </Form>
          </Card>
        </div>
      ) : null}

      <Card className="pipeline-card" title="Inbound pipeline">
        <Typography.Paragraph type="secondary">
          Safe processing diagnostics only. Telegram payloads and channel secrets are never shown.
        </Typography.Paragraph>
        <Table<ChannelInboundEvent>
          columns={[
            {
              dataIndex: 'receivedAt',
              render: (value: string) => new Date(value).toLocaleString(),
              title: 'Received',
            },
            { dataIndex: 'externalUpdateId', title: 'Update ID' },
            {
              render: (_, event) => <Tag>{event.inboxRecord?.status ?? 'NOT_CREATED'}</Tag>,
              title: 'Inbox',
            },
            {
              render: (_, event) =>
                event.inboxRecord
                  ? `${event.inboxRecord.attempts}/${event.inboxRecord.maxAttempts}`
                  : '—',
              title: 'Attempts',
            },
            {
              render: (_, event) => event.inboxRecord?.lastError ?? '—',
              title: 'Safe error',
            },
            {
              render: (_, event) => event.inboxRecord?.normalizedEvent?.type ?? '—',
              title: 'Normalized',
            },
            {
              render: (_, event) => event.inboxRecord?.normalizedEvent?.message?.contactId ?? '—',
              title: 'Contact ID',
            },
            { dataIndex: 'correlationId', title: 'Correlation ID' },
          ]}
          dataSource={inbound.data ?? []}
          loading={inbound.isLoading}
          locale={{
            emptyText: inbound.isError
              ? 'Inbound diagnostics could not be loaded'
              : 'No Telegram updates received yet',
          }}
          pagination={false}
          rowKey={(event) => `${event.externalUpdateId}-${event.receivedAt}`}
          scroll={{ x: 1100 }}
          size="small"
        />
      </Card>

      <Card className="pipeline-card" title="Outbound pipeline">
        <Typography.Paragraph type="secondary">
          Safe delivery diagnostics only. Message content and channel secrets are never shown.
        </Typography.Paragraph>
        <Table<ChannelOutboundEvent>
          columns={[
            {
              dataIndex: 'createdAt',
              render: (value: string) => new Date(value).toLocaleString(),
              title: 'Created',
            },
            {
              dataIndex: 'status',
              render: (value: string) => <Tag>{value}</Tag>,
              title: 'Outbox',
            },
            {
              render: (_, event) => `${event.attempts}/${event.maxAttempts}`,
              title: 'Attempts',
            },
            {
              render: (_, event) => event.message?.status ?? '—',
              title: 'Message',
            },
            {
              render: (_, event) => event.lastError ?? '—',
              title: 'Safe error',
            },
            {
              render: (_, event) => event.message?.externalMessageId ?? '—',
              title: 'Telegram message ID',
            },
          ]}
          dataSource={outbound.data ?? []}
          loading={outbound.isLoading}
          locale={{
            emptyText: outbound.isError
              ? 'Outbound diagnostics could not be loaded'
              : 'No outbound messages created yet',
          }}
          pagination={false}
          rowKey="id"
          scroll={{ x: 900 }}
          size="small"
        />
      </Card>
    </section>
  );
}
