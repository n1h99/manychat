import { Alert, Button, Form, Input, Modal, Table, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';

import { apiRequest, getUserErrorMessage } from '../api';
import { useAuth } from '../auth';
import { hasProjectPermission, useProjectAccess } from '../project-access';
import { StatusText } from '../status-text';

interface Segment {
  filter: Record<string, unknown>;
  id: string;
  name: string;
  status: 'ACTIVE' | 'ARCHIVED';
  updatedAt: string;
}

export function SegmentsPage() {
  const { projectId } = useParams();
  const { accessToken } = useAuth();
  const access = useProjectAccess(projectId);
  const cache = useQueryClient();
  const segments = useQuery({
    enabled: Boolean(projectId),
    queryFn: () => apiRequest<Segment[]>(`/api/v1/projects/${projectId}/segments`, {}, accessToken),
    queryKey: ['segments', projectId],
  });
  const invalidate = () => cache.invalidateQueries({ queryKey: ['segments', projectId] });
  const [deletingSegment, setDeletingSegment] = useState<Segment>();
  const [archiving, setArchiving] = useState(false);
  const create = useMutation({
    mutationFn: (input: { filter: Record<string, unknown>; name: string }) =>
      apiRequest<Segment>(
        `/api/v1/projects/${projectId}/segments`,
        { body: JSON.stringify(input), method: 'POST' },
        accessToken,
      ),
    onSuccess: invalidate,
  });
  const archive = useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>(
        `/api/v1/projects/${projectId}/segments/${id}`,
        { method: 'DELETE' },
        accessToken,
      ),
    onSuccess: invalidate,
  });
  const canEdit = hasProjectPermission(access.data, 'contacts:update');
  return (
    <section>
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>Segments</Typography.Title>
          <Typography.Text type="secondary">
            Saved filters whose membership is calculated when used.
          </Typography.Text>
        </div>
      </div>
      {canEdit ? (
        <Form
          className="segment-create-form surface"
          layout="inline"
          onFinish={async (values: { filter: string; name: string }) => {
            let filter: Record<string, unknown>;
            try {
              filter = JSON.parse(values.filter) as Record<string, unknown>;
            } catch {
              void message.error('Segment could not be created. The filter is not valid JSON.');
              return;
            }
            try {
              await create.mutateAsync({ filter, name: values.name });
              void message.success('Segment created.');
            } catch (error) {
              void message.error(getUserErrorMessage(error, 'Segment could not be created.'));
            }
          }}
        >
          <Form.Item label="Name" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            initialValue='{"status":"ACTIVE"}'
            label="Filter"
            name="filter"
            rules={[{ required: true }]}
          >
            <Input aria-label="Segment filter JSON" />
          </Form.Item>
          <Button htmlType="submit" loading={create.isPending} type="primary">
            Create segment
          </Button>
        </Form>
      ) : null}
      {segments.isError ? (
        <Alert
          message={getUserErrorMessage(segments.error, 'Segments could not be loaded.')}
          showIcon
          type="error"
        />
      ) : null}
      <Table<Segment>
        columns={[
          { dataIndex: 'name', title: 'Name' },
          {
            dataIndex: 'filter',
            render: (filter) => <code>{JSON.stringify(filter)}</code>,
            title: 'Filter',
          },
          {
            dataIndex: 'status',
            render: (status) => <StatusText status={status} />,
            title: 'Status',
          },
          {
            dataIndex: 'updatedAt',
            render: (value) => new Date(value).toLocaleString(),
            title: 'Updated',
          },
          {
            key: 'actions',
            render: (_, row) =>
              canEdit ? (
                <Button danger size="small" onClick={() => setDeletingSegment(row)}>
                  Archive
                </Button>
              ) : (
                '—'
              ),
            title: 'Actions',
          },
        ]}
        dataSource={segments.data ?? []}
        loading={segments.isLoading}
        rowKey="id"
      />
      <Modal
        className="account-confirm-modal"
        footer={null}
        onCancel={() => setDeletingSegment(undefined)}
        open={Boolean(deletingSegment)}
        title="Archive this segment?"
        width={460}
      >
        <Typography.Paragraph type="secondary">
          {deletingSegment
            ? `${deletingSegment.name} will be archived and removed from active filter lists.`
            : ''}
        </Typography.Paragraph>
        <div className="modal-form-actions">
          <Button onClick={() => setDeletingSegment(undefined)}>Cancel</Button>
          <Button
            danger
            loading={archiving}
            onClick={async () => {
              if (!deletingSegment) return;
              setArchiving(true);
              try {
                await archive.mutateAsync(deletingSegment.id);
                void message.success('Segment archived.');
                setDeletingSegment(undefined);
              } catch (error) {
                void message.error(getUserErrorMessage(error, 'Segment could not be archived.'));
              } finally {
                setArchiving(false);
              }
            }}
          >
            Archive segment
          </Button>
        </div>
      </Modal>
    </section>
  );
}
