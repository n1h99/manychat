import { EditOutlined, InboxOutlined, PlusOutlined, UndoOutlined } from '@ant-design/icons';
import {
  Button,
  Drawer,
  Form,
  Input,
  Segmented,
  Select,
  Space,
  Table,
  Typography,
  message,
} from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';

import { apiRequest } from '../api';
import { useAuth } from '../auth';

interface Field {
  id: string;
  key: string;
  name: string;
  type: string;
  options: string[] | null;
  description: string | null;
  archivedAt: string | null;
}
const fieldTypes = [
  'TEXT',
  'NUMBER',
  'BOOLEAN',
  'DATE',
  'DATETIME',
  'SELECT',
  'MULTI_SELECT',
  'JSON',
];
const fieldTypeLabels: Record<string, string> = {
  BOOLEAN: 'Boolean',
  DATE: 'Date',
  DATETIME: 'Date & time',
  JSON: 'JSON',
  MULTI_SELECT: 'Multi-select',
  NUMBER: 'Number',
  SELECT: 'Select',
  TEXT: 'Text',
};

export function CustomFieldsPage() {
  const { projectId } = useParams();
  const { accessToken } = useAuth();
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Field>();
  const [type, setType] = useState('TEXT');
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [form] = Form.useForm();
  const fields = useQuery({
    enabled: Boolean(projectId),
    queryFn: () =>
      apiRequest<Field[]>(
        `/api/v1/projects/${projectId}/custom-fields?archived=${view === 'archived'}`,
        {},
        accessToken,
      ),
    queryKey: ['custom-fields', projectId, accessToken, view],
  });
  const reload = () => cache.invalidateQueries({ queryKey: ['custom-fields', projectId] });
  return (
    <section>
      <div className="page-heading-row">
        <div>
          <Typography.Text className="header-kicker">Data model</Typography.Text>
          <Typography.Title level={2}>Custom fields</Typography.Title>
          <Typography.Text type="secondary">
            Typed, project-specific data available on every contact.
          </Typography.Text>
        </div>
        <Button
          icon={<PlusOutlined />}
          onClick={() => {
            form.resetFields();
            setEditing(undefined);
            setType('TEXT');
            setOpen(true);
          }}
          type="primary"
        >
          Create field
        </Button>
      </div>
      <Segmented
        className="archive-view-switch"
        onChange={(value) => setView(value as 'active' | 'archived')}
        options={[
          { label: 'Active fields', value: 'active' },
          { label: 'Archived', value: 'archived' },
        ]}
        value={view}
      />
      <Table<Field>
        columns={[
          {
            dataIndex: 'name',
            render: (name: string) => <Typography.Text strong>{name}</Typography.Text>,
            title: 'Name',
            width: '22%',
          },
          {
            dataIndex: 'key',
            render: (key: string) => <code className="field-key-label">{key}</code>,
            title: 'Key',
            width: '20%',
          },
          {
            dataIndex: 'type',
            render: (value: string) => (
              <span className="field-type-label">{fieldTypeLabels[value] ?? value}</span>
            ),
            title: 'Type',
            width: '20%',
          },
          {
            dataIndex: 'options',
            render: (options) =>
              options?.length ? (
                options.join(', ')
              ) : (
                <Typography.Text type="secondary">—</Typography.Text>
              ),
            title: 'Options',
          },
          {
            align: 'right',
            render: (_, row) => (
              <Space size={8}>
                {view === 'active' ? (
                  <>
                    <Button
                      icon={<EditOutlined />}
                      onClick={() => {
                        form.setFieldsValue({ ...row, options: row.options?.join(', ') });
                        setEditing(row);
                        setType(row.type);
                        setOpen(true);
                      }}
                      size="small"
                    >
                      Edit
                    </Button>
                    <Button
                      danger
                      icon={<InboxOutlined />}
                      onClick={() =>
                        void apiRequest(
                          `/api/v1/projects/${projectId}/custom-fields/${row.id}`,
                          { method: 'DELETE' },
                          accessToken,
                        ).then(async () => {
                          await reload();
                          void message.success('Custom field archived.');
                        })
                      }
                      size="small"
                    >
                      Archive
                    </Button>
                  </>
                ) : (
                  <Button
                    icon={<UndoOutlined />}
                    onClick={() =>
                      void apiRequest(
                        `/api/v1/projects/${projectId}/custom-fields/${row.id}/restore`,
                        { method: 'POST' },
                        accessToken,
                      ).then(async () => {
                        await reload();
                        void message.success('Custom field restored.');
                      })
                    }
                    size="small"
                    type="primary"
                  >
                    Restore
                  </Button>
                )}
              </Space>
            ),
            title: 'Actions',
            width: 190,
          },
        ]}
        dataSource={fields.data ?? []}
        loading={fields.isLoading}
        pagination={false}
        rowKey="id"
      />
      <Drawer
        destroyOnHidden
        onClose={() => setOpen(false)}
        open={open}
        title={editing ? 'Edit custom field' : 'Create custom field'}
        width={440}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            const payload = {
              ...values,
              options: values.options
                ? values.options
                    .split(',')
                    .map((value: string) => value.trim())
                    .filter(Boolean)
                : undefined,
            };
            await apiRequest(
              `/api/v1/projects/${projectId}/custom-fields${editing ? `/${editing.id}` : ''}`,
              {
                body: JSON.stringify(
                  editing
                    ? {
                        description: payload.description,
                        name: payload.name,
                        options: payload.options,
                      }
                    : payload,
                ),
                method: editing ? 'PATCH' : 'POST',
              },
              accessToken,
            );
            form.resetFields();
            setOpen(false);
            await reload();
          }}
        >
          <Form.Item label="Name" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            label="Key"
            name="key"
            rules={[{ pattern: /^[a-z][a-z0-9_]{0,63}$/, required: true }]}
          >
            <Input disabled={Boolean(editing)} />
          </Form.Item>
          <Form.Item label="Type" name="type" rules={[{ required: true }]}>
            <Select
              disabled={Boolean(editing)}
              onChange={setType}
              options={fieldTypes.map((value) => ({ value }))}
            />
          </Form.Item>
          {type === 'SELECT' || type === 'MULTI_SELECT' ? (
            <Form.Item
              label="Options (comma-separated)"
              name="options"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
          ) : null}
          <Form.Item label="Description" name="description">
            <Input.TextArea />
          </Form.Item>
          <Button block htmlType="submit" type="primary">
            {editing ? 'Save changes' : 'Create'}
          </Button>
        </Form>
      </Drawer>
    </section>
  );
}
