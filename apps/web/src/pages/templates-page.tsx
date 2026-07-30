import { Button, Form, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { useState } from 'react';
import { useParams } from 'react-router';

import { useMediaAssets } from '../media-api';
import { hasProjectPermission, useProjectAccess } from '../project-access';
import {
  type MessageTemplate,
  type TelegramInlineKeyboardButton,
  type TemplateInput,
  useTemplateMutations,
  useTemplates,
} from '../templates-api';

type TemplateFormInput = Omit<TemplateInput, 'inlineKeyboard'> & {
  buttonRows?: Array<{ buttons?: TelegramInlineKeyboardButton[] }>;
};

export function TemplatesPage() {
  const { projectId } = useParams();
  const templates = useTemplates(projectId);
  const assets = useMediaAssets(projectId);
  const access = useProjectAccess(projectId);
  const mutations = useTemplateMutations(projectId);
  const canManage = hasProjectPermission(access.data, 'templates:manage');
  const [editing, setEditing] = useState<MessageTemplate | 'new'>();
  const [previewing, setPreviewing] = useState<MessageTemplate>();
  const [previewVariables, setPreviewVariables] = useState(
    JSON.stringify({ contact: { firstName: 'Eldar' } }, null, 2),
  );
  const [previewResult, setPreviewResult] = useState<{
    missing: string[];
    output: string;
  }>();
  const [form] = Form.useForm<TemplateFormInput>();
  const kind = Form.useWatch('kind', form) ?? 'TEXT';

  const open = (template?: MessageTemplate) => {
    setEditing(template ?? 'new');
    const version = template?.draftVersion ?? template?.activeVersion;
    form.setFieldsValue({
      kind: version?.kind ?? 'TEXT',
      name: template?.name ?? '',
      ...(template?.description ? { description: template.description } : {}),
      ...(version?.mediaAssetId ? { mediaAssetId: version.mediaAssetId } : {}),
      ...(version?.content.caption !== undefined ? { caption: version.content.caption } : {}),
      ...(version?.content.inlineKeyboard
        ? {
            buttonRows: version.content.inlineKeyboard.map((buttons) => ({
              buttons,
            })),
          }
        : {}),
      ...(version?.content.text !== undefined ? { text: version.content.text } : {}),
    });
  };

  const save = async (values: TemplateFormInput) => {
    try {
      const input: TemplateInput = {
        ...values,
        ...(values.buttonRows?.length
          ? {
              inlineKeyboard: values.buttonRows
                .map((row) => row.buttons ?? [])
                .filter((row) => row.length > 0),
            }
          : {}),
      };
      delete (input as TemplateInput & { buttonRows?: unknown }).buttonRows;
      if (editing === 'new') await mutations.create.mutateAsync(input);
      else if (editing) await mutations.update.mutateAsync({ id: editing.id, ...input });
      setEditing(undefined);
      form.resetFields();
      void message.success('Template draft saved.');
    } catch {
      void message.error('Template could not be saved.');
    }
  };

  return (
    <section>
      <div className="page-heading-row">
        <div>
          <Typography.Text className="header-kicker">Content library</Typography.Text>
          <Typography.Title level={2}>Message templates</Typography.Title>
          <Typography.Text type="secondary">
            Reusable, versioned content for scenarios and broadcasts.
          </Typography.Text>
        </div>
        {canManage ? (
          <Button onClick={() => open()} type="primary">
            New template
          </Button>
        ) : null}
      </div>
      <Table<MessageTemplate>
        dataSource={templates.data ?? []}
        loading={templates.isLoading}
        rowKey="id"
        columns={[
          { dataIndex: 'name', title: 'Name' },
          {
            title: 'Kind',
            render: (_, template) => (template.draftVersion ?? template.activeVersion)?.kind ?? '—',
          },
          { dataIndex: 'status', title: 'Status', render: (value) => <Tag>{value}</Tag> },
          {
            key: 'actions',
            render: (_, template) => (
              <Space>
                <Button
                  onClick={() => {
                    setPreviewing(template);
                    setPreviewResult(undefined);
                  }}
                  size="small"
                >
                  Preview
                </Button>
                {canManage ? (
                  <Button onClick={() => open(template)} size="small">
                    Edit
                  </Button>
                ) : null}
                {canManage && template.draftVersion ? (
                  <Button
                    loading={mutations.publish.isPending}
                    onClick={() => void mutations.publish.mutateAsync(template.id)}
                    size="small"
                    type="primary"
                  >
                    Publish
                  </Button>
                ) : null}
                {canManage ? (
                  <Button
                    danger
                    onClick={() =>
                      Modal.confirm({
                        onOk: () => mutations.archive.mutateAsync(template.id),
                        title: 'Archive this template?',
                      })
                    }
                    size="small"
                  >
                    Archive
                  </Button>
                ) : null}
              </Space>
            ),
            title: 'Actions',
          },
        ]}
      />
      <Modal
        destroyOnHidden
        footer={null}
        onCancel={() => setEditing(undefined)}
        open={Boolean(editing)}
        title={editing === 'new' ? 'New template' : 'Edit template draft'}
      >
        <Form form={form} initialValues={{ kind: 'TEXT' }} layout="vertical" onFinish={save}>
          <Form.Item label="Name" name="name" rules={[{ required: true }]}>
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item label="Description" name="description">
            <Input.TextArea maxLength={500} />
          </Form.Item>
          <Form.Item label="Type" name="kind" rules={[{ required: true }]}>
            <Select
              options={[
                { label: 'Text', value: 'TEXT' },
                { label: 'Photo', value: 'PHOTO' },
                { label: 'Document', value: 'DOCUMENT' },
                { label: 'Video', value: 'VIDEO' },
                { label: 'Audio', value: 'AUDIO' },
                { label: 'Voice message', value: 'VOICE' },
                { label: 'Video note', value: 'VIDEO_NOTE' },
                { label: 'Animation', value: 'ANIMATION' },
              ]}
            />
          </Form.Item>
          {kind === 'TEXT' ? (
            <Form.Item label="Text" name="text" rules={[{ required: true }]}>
              <Input.TextArea maxLength={4096} rows={6} />
            </Form.Item>
          ) : (
            <>
              <Form.Item label="Media asset" name="mediaAssetId" rules={[{ required: true }]}>
                <Select
                  options={(assets.data ?? [])
                    .filter((asset) => asset.status === 'AVAILABLE' && asset.kind === kind)
                    .map((asset) => ({
                      label: asset.originalFilename ?? asset.id,
                      value: asset.id,
                    }))}
                />
              </Form.Item>
              {kind === 'VIDEO_NOTE' ? null : (
                <Form.Item label="Caption" name="caption">
                  <Input.TextArea maxLength={1024} rows={4} />
                </Form.Item>
              )}
            </>
          )}
          <Form.List name="buttonRows">
            {(rows, { add: addRow, remove: removeRow }) => (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Typography.Text strong>Inline buttons</Typography.Text>
                {rows.map((row, rowIndex) => (
                  <Space
                    align="start"
                    className="template-button-row"
                    direction="vertical"
                    key={row.key}
                  >
                    <Space>
                      <Typography.Text>Row {rowIndex + 1}</Typography.Text>
                      <Button danger onClick={() => removeRow(row.name)} size="small">
                        Remove row
                      </Button>
                    </Space>
                    <Form.List name={[row.name, 'buttons']}>
                      {(buttons, { add: addButton, remove: removeButton }) => (
                        <Space direction="vertical" style={{ width: '100%' }}>
                          {buttons.map((button) => (
                            <Space align="start" key={button.key} wrap>
                              <Form.Item
                                label="Label"
                                name={[button.name, 'text']}
                                rules={[{ required: true }]}
                              >
                                <Input maxLength={64} placeholder="Up to 1 000" />
                              </Form.Item>
                              <Form.Item label="Callback data" name={[button.name, 'callbackData']}>
                                <Input maxLength={64} placeholder="budget:under_1000" />
                              </Form.Item>
                              <Form.Item label="URL" name={[button.name, 'url']}>
                                <Input placeholder="https://…" />
                              </Form.Item>
                              <Button danger onClick={() => removeButton(button.name)}>
                                Remove
                              </Button>
                            </Space>
                          ))}
                          <Button
                            disabled={buttons.length >= 8}
                            onClick={() => addButton({ callbackData: '', text: '' })}
                            size="small"
                          >
                            Add button
                          </Button>
                        </Space>
                      )}
                    </Form.List>
                  </Space>
                ))}
                <Button
                  disabled={rows.length >= 8}
                  onClick={() => addRow({ buttons: [{ callbackData: '', text: '' }] })}
                >
                  Add button row
                </Button>
                <Typography.Text type="secondary">
                  Set exactly one action per button: callback data for automation, or an HTTP(S)
                  URL.
                </Typography.Text>
              </Space>
            )}
          </Form.List>
          <Typography.Paragraph type="secondary">
            Variables use paths such as {'{{contact.firstName}}'} and are checked during preview or
            execution.
          </Typography.Paragraph>
          <Button
            htmlType="submit"
            loading={mutations.create.isPending || mutations.update.isPending}
            type="primary"
          >
            Save draft
          </Button>
        </Form>
      </Modal>
      <Modal
        footer={null}
        onCancel={() => setPreviewing(undefined)}
        open={Boolean(previewing)}
        title="Template preview"
      >
        <Typography.Paragraph type="secondary">
          Provide JSON variables. Preview never sends a Telegram message.
        </Typography.Paragraph>
        <Input.TextArea
          aria-label="Preview variables"
          onChange={(event) => setPreviewVariables(event.target.value)}
          rows={8}
          value={previewVariables}
        />
        <Button
          loading={mutations.preview.isPending}
          onClick={async () => {
            if (!previewing) return;
            try {
              const variables = JSON.parse(previewVariables) as unknown;
              if (!variables || typeof variables !== 'object' || Array.isArray(variables))
                throw new Error('Variables must be an object');
              const result = await mutations.preview.mutateAsync({
                id: previewing.id,
                variables: variables as Record<string, unknown>,
              });
              setPreviewResult(result);
            } catch {
              setPreviewResult(undefined);
              void message.error('Preview variables must be valid JSON.');
            }
          }}
          style={{ marginTop: 12 }}
          type="primary"
        >
          Render preview
        </Button>
        {previewResult ? (
          <Space direction="vertical" style={{ marginTop: 16, width: '100%' }}>
            {previewResult.missing.length ? (
              <Tag color="warning">Missing: {previewResult.missing.join(', ')}</Tag>
            ) : (
              <Tag color="success">All variables resolved</Tag>
            )}
            <Typography.Paragraph copyable>
              {previewResult.output || '(empty output)'}
            </Typography.Paragraph>
          </Space>
        ) : null}
      </Modal>
    </section>
  );
}
