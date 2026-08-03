import { EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Empty, Modal, Select, Space, Table, Typography, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';

import { getUserErrorMessage } from './api';
import { channelAccountLabel } from './channel-provider';
import { useChannels } from './channels-api';
import { humanizeStatus } from './humanize';
import { StatusText } from './status-text';
import {
  type WhatsAppMessageTemplate,
  type WhatsAppTemplateComponent,
  useWhatsAppTemplateMutations,
  useWhatsAppTemplates,
} from './whatsapp-templates-api';

function componentLabel(component: WhatsAppTemplateComponent) {
  const labels = {
    BODY: 'Body',
    BUTTONS: 'Buttons',
    FOOTER: 'Footer',
    HEADER: 'Header',
  } as const;
  return labels[component.type];
}

export function WhatsAppTemplatesPanel({
  canManage,
  projectId,
}: {
  canManage: boolean;
  projectId: string | undefined;
}) {
  const channels = useChannels(projectId);
  const whatsappChannels = useMemo(
    () => (channels.data ?? []).filter((channel) => channel.type === 'WHATSAPP'),
    [channels.data],
  );
  const [connectionId, setConnectionId] = useState<string>();
  const [previewing, setPreviewing] = useState<WhatsAppMessageTemplate>();
  const templates = useWhatsAppTemplates(projectId, connectionId);
  const mutations = useWhatsAppTemplateMutations(projectId, connectionId);
  const connection = whatsappChannels.find((channel) => channel.id === connectionId);

  useEffect(() => {
    if (!connectionId && whatsappChannels[0]) setConnectionId(whatsappChannels[0].id);
    if (connectionId && !whatsappChannels.some((channel) => channel.id === connectionId)) {
      setConnectionId(whatsappChannels[0]?.id);
    }
  }, [connectionId, whatsappChannels]);

  if (channels.isError) {
    return (
      <Alert
        message={getUserErrorMessage(channels.error, 'WhatsApp channels could not be loaded.')}
        showIcon
        type="error"
      />
    );
  }

  if (!channels.isLoading && !whatsappChannels.length) {
    return (
      <Card className="whatsapp-template-empty">
        <Empty
          description="Connect a WhatsApp Business channel before syncing Meta templates."
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </Card>
    );
  }

  return (
    <div className="whatsapp-template-workspace">
      <Alert
        className="channel-soft-notice"
        description="Templates are created, reviewed and approved in WhatsApp Manager. Omnicus keeps a read-only synced copy for broadcasts and automations, so approval status is never guessed locally."
        message="Meta owns WhatsApp template approval"
        showIcon
        type="info"
      />
      <Card className="whatsapp-template-toolbar">
        <div>
          <Typography.Text strong>WhatsApp channel</Typography.Text>
          <Select
            loading={channels.isLoading}
            onChange={setConnectionId}
            optionFilterProp="label"
            options={whatsappChannels.map((channel) => ({
              label: `${channel.name} · ${channelAccountLabel(channel)}`,
              value: channel.id,
            }))}
            placeholder="Choose a business number"
            showSearch
            value={connectionId}
          />
        </div>
        {canManage ? (
          <Button
            disabled={!connectionId || connection?.status !== 'ACTIVE'}
            icon={<ReloadOutlined />}
            loading={mutations.sync.isPending}
            onClick={async () => {
              try {
                await mutations.sync.mutateAsync();
                void message.success('WhatsApp templates synced from Meta.');
              } catch (error) {
                void message.error(
                  getUserErrorMessage(error, 'WhatsApp templates could not be synced.'),
                );
              }
            }}
            type="primary"
          >
            Sync from Meta
          </Button>
        ) : null}
      </Card>

      {connection && connection.status !== 'ACTIVE' ? (
        <Alert
          className="form-alert"
          description="Finish and activate this WhatsApp connection before requesting its approved templates from Meta."
          message="Channel is not active"
          showIcon
          type="warning"
        />
      ) : null}
      {templates.isError ? (
        <Alert
          className="form-alert"
          message={getUserErrorMessage(templates.error, 'WhatsApp templates could not be loaded.')}
          showIcon
          type="error"
        />
      ) : null}

      <Table<WhatsAppMessageTemplate>
        columns={[
          { dataIndex: 'name', ellipsis: true, title: 'Template', width: 250 },
          { dataIndex: 'languageCode', title: 'Language', width: 120 },
          {
            dataIndex: 'category',
            render: (value: string) => humanizeStatus(value),
            title: 'Purpose',
            width: 150,
          },
          {
            dataIndex: 'status',
            render: (value: string) => <StatusText status={value} />,
            title: 'Meta status',
            width: 140,
          },
          {
            dataIndex: 'quality',
            render: (value: string) => (
              <StatusText
                label={humanizeStatus(value)}
                status={value === 'GREEN' ? 'SUCCEEDED' : value === 'RED' ? 'FAILED' : 'PENDING'}
              />
            ),
            title: 'Quality',
            width: 120,
          },
          {
            dataIndex: 'lastSyncedAt',
            render: (value: string) => new Date(value).toLocaleString(),
            title: 'Last synced',
            width: 190,
          },
          {
            key: 'actions',
            render: (_, template) => (
              <Button icon={<EyeOutlined />} onClick={() => setPreviewing(template)} size="small">
                View
              </Button>
            ),
            title: 'Content',
            width: 100,
          },
        ]}
        dataSource={templates.data ?? []}
        loading={channels.isLoading || templates.isLoading}
        locale={{
          emptyText: connectionId
            ? 'No templates have been synced for this number yet'
            : 'Choose a WhatsApp channel',
        }}
        pagination={false}
        rowKey="id"
        scroll={{ x: 1070 }}
        tableLayout="fixed"
      />

      <Modal
        footer={null}
        onCancel={() => setPreviewing(undefined)}
        open={Boolean(previewing)}
        title={previewing ? `${previewing.name} · ${previewing.languageCode}` : 'Template content'}
        width={640}
      >
        {previewing?.rejectionReasonCode ? (
          <Alert
            className="form-alert"
            description="Open this template in WhatsApp Manager for the full review guidance."
            message={`Meta review code: ${previewing.rejectionReasonCode}`}
            showIcon
            type="warning"
          />
        ) : null}
        <Space className="whatsapp-template-components" direction="vertical" size={10}>
          {(previewing?.components ?? []).map((component, index) => (
            <div className="whatsapp-template-component" key={`${component.type}-${index}`}>
              <span>{componentLabel(component)}</span>
              {component.format ? <small>{humanizeStatus(component.format)}</small> : null}
              {component.text ? (
                <Typography.Paragraph>{component.text}</Typography.Paragraph>
              ) : null}
              {component.buttons?.length ? (
                <div className="whatsapp-template-buttons">
                  {component.buttons.map((button, buttonIndex) => (
                    <span key={`${button.type}-${buttonIndex}`}>{button.text}</span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </Space>
      </Modal>
    </div>
  );
}
