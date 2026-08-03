import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { ReloadOutlined, SafetyCertificateOutlined, SyncOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';

import { apiRequest, getUserErrorMessage } from '../api';
import { useAuth } from '../auth';
import { hasProjectPermission, useProjectAccess } from '../project-access';
import {
  humanizeAuditAction,
  humanizeEntity,
  humanizeOperationSource,
  humanizeReason,
  humanizeStatus,
} from '../humanize';
import { StatusText } from '../status-text';

interface OperationRow {
  attempts?: number;
  correlationId?: string;
  createdAt: string;
  entityId?: string;
  entityType: string;
  errorCode?: string;
  id: string;
  kind?: string;
  maxAttempts?: number;
  reconciliationAvailable: boolean;
  retryAvailable: boolean;
  source: 'AUTOMATION' | 'BROADCAST' | 'INBOX' | 'OUTBOX';
  status: string;
  updatedAt: string;
}

interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

interface AuditRow {
  action: string;
  actorEmailSnapshot: string | null;
  actorType: string;
  afterSafeJson: unknown;
  beforeSafeJson: unknown;
  correlationId: string;
  createdAt: string;
  entityId: string | null;
  entityType: string;
  id: string;
  reason: string | null;
}

type SummaryGroup = Array<{ _count: { _all: number }; status: string }>;
interface Summary {
  broadcasts: SummaryGroup;
  executions: SummaryGroup;
  inbox: SummaryGroup;
  outbox: SummaryGroup;
}

const operationSources = ['INBOX', 'OUTBOX', 'AUTOMATION', 'BROADCAST'] as const;
const operationStatuses = [
  'PENDING',
  'PROCESSING',
  'RETRY',
  'COMPLETED',
  'SUCCEEDED',
  'FAILED',
  'DEAD_LETTER',
  'UNKNOWN',
  'PAUSED',
] as const;

function terminalCount(groups: SummaryGroup | undefined, statuses: string[]) {
  return (groups ?? [])
    .filter((group) => statuses.includes(group.status))
    .reduce((total, group) => total + group._count._all, 0);
}

export function OperationsPage() {
  const { projectId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { accessToken } = useAuth();
  const access = useProjectAccess(projectId);
  const client = useQueryClient();
  const sourceParam = searchParams.get('source');
  const statusParam = searchParams.get('status');
  const connectionIdParam = searchParams.get('connectionId');
  const source =
    sourceParam && operationSources.includes(sourceParam as (typeof operationSources)[number])
      ? sourceParam
      : undefined;
  const status =
    statusParam && operationStatuses.includes(statusParam as (typeof operationStatuses)[number])
      ? statusParam
      : undefined;
  const connectionId =
    connectionIdParam && connectionIdParam.length >= 1 && connectionIdParam.length <= 160
      ? connectionIdParam
      : undefined;
  const [correlationId, setCorrelationId] = useState('');
  const [page, setPage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);
  const [range, setRange] = useState<[string, string]>();
  const [recovery, setRecovery] = useState<{
    mode: 'RECONCILE' | 'RETRY';
    row: OperationRow;
  }>();
  const [auditDetails, setAuditDetails] = useState<AuditRow>();
  const [form] = Form.useForm();
  const updateUrlFilter = (key: 'source' | 'status', value?: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setPage(1);
    setSearchParams(next, { replace: true });
  };
  const queryString = useMemo(() => {
    const query = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (source) query.set('source', source);
    if (status) query.set('status', status);
    if (connectionId) query.set('connectionId', connectionId);
    if (correlationId.trim()) query.set('correlationId', correlationId.trim());
    if (range) {
      query.set('from', range[0]);
      query.set('to', range[1]);
    }
    return query.toString();
  }, [connectionId, correlationId, page, range, source, status]);
  const operations = useQuery({
    enabled: Boolean(projectId),
    queryFn: () =>
      apiRequest<Paged<OperationRow>>(
        `/api/v1/projects/${projectId}/operations?${queryString}`,
        {},
        accessToken,
      ),
    queryKey: ['operations', projectId, queryString, accessToken],
    refetchInterval: 15_000,
  });
  const summary = useQuery({
    enabled: Boolean(projectId),
    queryFn: () =>
      apiRequest<Summary>(`/api/v1/projects/${projectId}/operations/summary`, {}, accessToken),
    queryKey: ['operations-summary', projectId, accessToken],
    refetchInterval: 15_000,
  });
  const audit = useQuery({
    enabled: Boolean(projectId),
    queryFn: () =>
      apiRequest<Paged<AuditRow>>(
        `/api/v1/projects/${projectId}/audit?page=${auditPage}&pageSize=50`,
        {},
        accessToken,
      ),
    queryKey: ['project-audit', projectId, auditPage, accessToken],
  });
  const canRecover = hasProjectPermission(access.data, 'project:manage');
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['operations', projectId] }),
      client.invalidateQueries({ queryKey: ['operations-summary', projectId] }),
      client.invalidateQueries({ queryKey: ['project-audit', projectId] }),
    ]);
  };

  return (
    <section className="operations-page">
      <div className="page-heading-row">
        <div>
          <Typography.Title level={2}>Operations & audit</Typography.Title>
          <Typography.Text type="secondary">
            Safe delivery journals, recovery actions and immutable operator history.
          </Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>
      <div className="operations-summary-grid">
        <Card>
          <Statistic
            title="Inbound terminal"
            value={terminalCount(summary.data?.inbox, ['FAILED', 'DEAD_LETTER'])}
          />
        </Card>
        <Card>
          <Statistic
            title="Outbound failed"
            value={terminalCount(summary.data?.outbox, ['FAILED'])}
          />
        </Card>
        <Card>
          <Statistic
            title="Unknown outcomes"
            value={terminalCount(summary.data?.outbox, ['UNKNOWN'])}
          />
        </Card>
        <Card>
          <Statistic
            title="Automation failed"
            value={terminalCount(summary.data?.executions, ['FAILED'])}
          />
        </Card>
      </div>
      <Tabs
        items={[
          {
            key: 'operations',
            label: 'Operations',
            children: (
              <>
                <div className="operations-filters surface">
                  <Select
                    allowClear
                    onChange={(value) => updateUrlFilter('source', value)}
                    options={operationSources.map((value) => ({
                      label: humanizeOperationSource(value),
                      value,
                    }))}
                    placeholder="Source"
                    value={source}
                  />
                  <Select
                    allowClear
                    onChange={(value) => updateUrlFilter('status', value)}
                    options={operationStatuses.map((value) => ({
                      label: humanizeStatus(value),
                      value,
                    }))}
                    placeholder="Status"
                    value={status}
                  />
                  <Input.Search
                    allowClear
                    onSearch={(value) => {
                      setPage(1);
                      setCorrelationId(value);
                    }}
                    placeholder="Correlation ID"
                  />
                  <DatePicker.RangePicker
                    onChange={(dates) => {
                      setPage(1);
                      setRange(
                        dates?.[0] && dates[1]
                          ? [
                              dates[0].startOf('day').toISOString(),
                              dates[1].endOf('day').toISOString(),
                            ]
                          : undefined,
                      );
                    }}
                  />
                </div>
                {operations.isError ? (
                  <Alert
                    message={getUserErrorMessage(
                      operations.error,
                      'Operations could not be loaded.',
                    )}
                    showIcon
                    type="error"
                  />
                ) : null}
                <Table<OperationRow>
                  columns={[
                    {
                      dataIndex: 'source',
                      render: (value) => <Tag>{humanizeOperationSource(value)}</Tag>,
                      title: 'Source',
                      width: 120,
                    },
                    {
                      render: (_, row) => (
                        <div className="operation-entity-cell">
                          <strong>{humanizeEntity(row.entityType)}</strong>
                          <small>{row.id}</small>
                        </div>
                      ),
                      title: 'Operation',
                    },
                    {
                      dataIndex: 'status',
                      render: (value) => <StatusText status={value} />,
                      title: 'Status',
                      width: 135,
                    },
                    {
                      dataIndex: 'errorCode',
                      render: (value) => (value ? humanizeReason(value) : 'No error'),
                      title: 'What needs attention',
                      width: 220,
                    },
                    {
                      render: (_, row) =>
                        row.attempts === undefined
                          ? '—'
                          : `${row.attempts}/${row.maxAttempts ?? '—'}`,
                      title: 'Attempts',
                      width: 100,
                    },
                    {
                      dataIndex: 'correlationId',
                      ellipsis: true,
                      render: (value) => value ?? '—',
                      title: 'Correlation',
                      width: 210,
                    },
                    {
                      dataIndex: 'updatedAt',
                      render: (value) => new Date(value).toLocaleString(),
                      title: 'Updated',
                      width: 180,
                    },
                    {
                      align: 'right',
                      render: (_, row) =>
                        canRecover ? (
                          <Space>
                            {row.retryAvailable && ['INBOX', 'OUTBOX'].includes(row.source) ? (
                              <Button
                                icon={<SyncOutlined />}
                                onClick={() => setRecovery({ mode: 'RETRY', row })}
                              >
                                Retry
                              </Button>
                            ) : null}
                            {row.reconciliationAvailable ? (
                              <Button
                                icon={<SafetyCertificateOutlined />}
                                onClick={() => setRecovery({ mode: 'RECONCILE', row })}
                              >
                                Reconcile
                              </Button>
                            ) : null}
                          </Space>
                        ) : null,
                      title: 'Recovery',
                      width: 210,
                    },
                  ]}
                  dataSource={operations.data?.items ?? []}
                  loading={operations.isLoading}
                  pagination={{
                    current: page,
                    onChange: setPage,
                    pageSize: 50,
                    showSizeChanger: false,
                    total: operations.data?.total ?? 0,
                  }}
                  rowKey={(row) => `${row.source}-${row.id}`}
                  scroll={{ x: 1400 }}
                />
              </>
            ),
          },
          {
            key: 'audit',
            label: 'Audit log',
            children: (
              <Table<AuditRow>
                columns={[
                  {
                    dataIndex: 'action',
                    render: (value) => humanizeAuditAction(value),
                    title: 'What happened',
                  },
                  {
                    dataIndex: 'actorEmailSnapshot',
                    render: (value, row) => value ?? humanizeEntity(row.actorType),
                    title: 'Who',
                  },
                  {
                    render: (_, row) =>
                      `${humanizeEntity(row.entityType)}${row.entityId ? ` · ${row.entityId}` : ''}`,
                    title: 'Item',
                  },
                  {
                    dataIndex: 'reason',
                    render: (value) => humanizeReason(value),
                    title: 'Why',
                  },
                  { dataIndex: 'correlationId', ellipsis: true, title: 'Correlation' },
                  {
                    dataIndex: 'createdAt',
                    render: (value) => new Date(value).toLocaleString(),
                    title: 'Time',
                  },
                ]}
                dataSource={audit.data?.items ?? []}
                loading={audit.isLoading}
                onRow={(row) => ({ onClick: () => setAuditDetails(row) })}
                pagination={{
                  current: auditPage,
                  onChange: setAuditPage,
                  pageSize: 50,
                  showSizeChanger: false,
                  total: audit.data?.total ?? 0,
                }}
                rowClassName="clickable-table-row"
                rowKey="id"
              />
            ),
          },
        ]}
      />
      <Modal
        destroyOnHidden
        footer={null}
        onCancel={() => {
          setRecovery(undefined);
          form.resetFields();
        }}
        open={Boolean(recovery)}
        title={
          recovery?.mode === 'RETRY' ? 'Retry terminal operation' : 'Reconcile unknown outcome'
        }
      >
        {recovery?.mode === 'RECONCILE' ? (
          <Alert
            className="form-alert"
            description="Choose Applied only with provider evidence. Choose Not applied when the provider confirms no side effect; Omnicus will then queue one safe retry."
            message="UNKNOWN is never retried blindly"
            showIcon
            type="warning"
          />
        ) : null}
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values: { outcome?: string; reason: string }) => {
            if (!recovery) return;
            const { row, mode } = recovery;
            const path =
              mode === 'RECONCILE'
                ? `/api/v1/projects/${projectId}/operations/outbox/${row.id}/reconcile`
                : `/api/v1/projects/${projectId}/operations/${row.source.toLowerCase()}/${row.id}/retry`;
            try {
              await apiRequest(path, { body: JSON.stringify(values), method: 'POST' }, accessToken);
              setRecovery(undefined);
              form.resetFields();
              await refresh();
              void message.success(mode === 'RECONCILE' ? 'Outcome reconciled.' : 'Retry queued.');
            } catch (cause) {
              void message.error(
                getUserErrorMessage(cause, 'The recovery action could not be completed.'),
              );
            }
          }}
        >
          {recovery?.mode === 'RECONCILE' ? (
            <Form.Item label="Provider evidence" name="outcome" rules={[{ required: true }]}>
              <Select
                options={[
                  { label: 'Provider confirms applied', value: 'APPLIED' },
                  { label: 'Provider confirms not applied', value: 'NOT_APPLIED' },
                ]}
              />
            </Form.Item>
          ) : null}
          <Form.Item label="Audit reason" name="reason" rules={[{ min: 3, required: true }]}>
            <Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} />
          </Form.Item>
          <Button htmlType="submit" type="primary">
            Confirm action
          </Button>
        </Form>
      </Modal>
      <Modal
        footer={null}
        onCancel={() => setAuditDetails(undefined)}
        open={Boolean(auditDetails)}
        title="Audit details"
        width={720}
      >
        {auditDetails ? (
          <Descriptions column={1} size="small">
            <Descriptions.Item label="What happened">
              {humanizeAuditAction(auditDetails.action)}
            </Descriptions.Item>
            <Descriptions.Item label="Correlation">{auditDetails.correlationId}</Descriptions.Item>
            <Descriptions.Item label="Before">
              <pre className="safe-json-view">
                {JSON.stringify(auditDetails.beforeSafeJson, null, 2)}
              </pre>
            </Descriptions.Item>
            <Descriptions.Item label="After">
              <pre className="safe-json-view">
                {JSON.stringify(auditDetails.afterSafeJson, null, 2)}
              </pre>
            </Descriptions.Item>
          </Descriptions>
        ) : null}
      </Modal>
    </section>
  );
}
