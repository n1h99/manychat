import {
  ApartmentOutlined,
  CheckCircleOutlined,
  CloudServerOutlined,
  CloseCircleOutlined,
  DatabaseOutlined,
  ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Col, Row, Table, Tabs, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { apiRequest, getUserErrorMessage } from '../api';
import { useAuth } from '../auth';
import { humanizeAuditAction, humanizeEntity, humanizeReason } from '../humanize';

interface SystemAlert {
  code: string;
  count?: number;
  description: string;
  severity: 'CRITICAL' | 'WARNING';
  title: string;
}
interface Snapshot {
  alerts: SystemAlert[];
  dependencies: Record<string, { latencyMs?: number; status: 'down' | 'up' }>;
  generatedAt: string;
  operationCounts: null | Record<string, number>;
  operationHistory: null | {
    older: OperationTotals;
    projects: ProjectOperationHistory[];
    recent: OperationTotals;
    windowHours: number;
  };
  overallStatus: 'ATTENTION' | 'DEGRADED' | 'HEALTHY';
  queues: Record<string, { active: number; delayed: number; failed: number; waiting: number }>;
}
interface OperationTotals {
  inboxTerminal: number;
  outboxFailed: number;
  outboxUnknown: number;
}
interface ProjectOperationHistory {
  olderFailed: number;
  olderInbox: number;
  olderUnknown: number;
  projectId: string;
  projectName: string;
  recentFailed: number;
  recentInbox: number;
  recentUnknown: number;
}
interface GlobalAudit {
  action: string;
  actorEmailSnapshot: string | null;
  actorType: string;
  correlationId: string;
  createdAt: string;
  entityType: string;
  id: string;
  projectNameSnapshot: string | null;
  reason: string | null;
}
interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export function SystemHealthPage() {
  const { accessToken } = useAuth();
  const [auditPage, setAuditPage] = useState(1);
  const health = useQuery({
    queryFn: () => apiRequest<Snapshot>('/api/v1/system/health', {}, accessToken),
    queryKey: ['system-health', accessToken],
    refetchInterval: 15_000,
  });
  const audit = useQuery({
    queryFn: () =>
      apiRequest<Paged<GlobalAudit>>(
        `/api/v1/system/audit?page=${auditPage}&pageSize=50`,
        {},
        accessToken,
      ),
    queryKey: ['system-audit', auditPage, accessToken],
  });
  const snapshot = health.data;
  const history = snapshot?.operationHistory;
  const olderOperationCount = history
    ? history.older.inboxTerminal + history.older.outboxFailed + history.older.outboxUnknown
    : 0;
  return (
    <section className="system-health-page">
      <div className="page-heading-row">
        <div>
          <Typography.Title level={2}>System health</Typography.Title>
          <Typography.Text type="secondary">
            Check whether the platform is working normally and see what needs attention.
          </Typography.Text>
        </div>
        <Button
          icon={<ReloadOutlined />}
          loading={health.isFetching}
          onClick={() => void health.refetch()}
        >
          Refresh
        </Button>
      </div>
      {health.isError ? (
        <Alert
          message={getUserErrorMessage(health.error, 'System health could not be loaded.')}
          showIcon
          type="error"
        />
      ) : null}
      <Card
        className={`health-overview health-overview--${snapshot?.overallStatus.toLowerCase() ?? 'loading'}`}
      >
        <div className="health-overview-copy">
          <span className="health-overview-icon">
            {snapshot?.overallStatus === 'HEALTHY' ? (
              <CheckCircleOutlined />
            ) : snapshot?.overallStatus === 'DEGRADED' ? (
              <CloseCircleOutlined />
            ) : (
              <WarningOutlined />
            )}
          </span>
          <div>
            <Typography.Text type="secondary">Platform status</Typography.Text>
            <Typography.Title level={3}>
              {overallStatusLabel(snapshot?.overallStatus)}
            </Typography.Title>
            <Typography.Text type="secondary">
              {overallStatusDescription(snapshot?.overallStatus)}
            </Typography.Text>
          </div>
        </div>
        <Typography.Text className="health-overview-updated" type="secondary">
          Updated {snapshot ? new Date(snapshot.generatedAt).toLocaleString() : '—'}
        </Typography.Text>
      </Card>
      <Row className="health-dependency-grid" gutter={[16, 16]}>
        {Object.entries(snapshot?.dependencies ?? {}).map(([name, dependency]) => (
          <Col key={name} lg={8} xs={24}>
            <Card className="health-dependency-card">
              <div className="health-dependency-heading">
                <span className="health-dependency-icon">{dependencyIcon(name)}</span>
                <Typography.Text className="health-dependency-name">
                  {dependencyLabel(name)}
                </Typography.Text>
                <i
                  aria-label={dependency.status === 'up' ? 'Working normally' : 'Unavailable'}
                  className={dependency.status === 'up' ? 'is-up' : 'is-down'}
                />
              </div>
              <strong>{dependency.status === 'up' ? 'Working normally' : 'Unavailable'}</strong>
              <small>
                {dependency.latencyMs === undefined
                  ? dependency.status === 'up'
                    ? 'Responding normally'
                    : 'The health check did not complete'
                  : `Responded in ${dependency.latencyMs} ms`}
              </small>
            </Card>
          </Col>
        ))}
      </Row>
      <Card className="health-workspace-card">
        <Tabs
          items={[
            {
              key: 'alerts',
              label: `Current alerts (${snapshot?.alerts.length ?? 0})`,
              children: (
                <div className="system-alert-list">
                  {snapshot?.alerts.length ? (
                    snapshot.alerts.map((item) => (
                      <div
                        className={`health-alert-card ${item.severity === 'CRITICAL' ? 'is-critical' : 'is-warning'}`}
                        key={item.code}
                      >
                        <span className="health-alert-icon">
                          {item.severity === 'CRITICAL' ? (
                            <CloseCircleOutlined />
                          ) : (
                            <WarningOutlined />
                          )}
                        </span>
                        <div className="health-alert-copy">
                          <strong>{humanizeHealthAlert(item.code, item.title)}</strong>
                          <p>{humanizeHealthDescription(item.code, item.description)}</p>
                          <OperationProjectLinks
                            alertCode={item.code}
                            projects={history?.projects ?? []}
                            window="recent"
                          />
                        </div>
                        {item.count === undefined ? null : (
                          <Tag>{healthCountLabel(item.code, item.count)}</Tag>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="health-all-clear">
                      <CheckCircleOutlined />
                      <div>
                        <strong>No active platform alerts</strong>
                        <span>All monitored services and operation journals look normal.</span>
                      </div>
                    </div>
                  )}
                  {olderOperationCount > 0 ? (
                    <div className="health-history-card">
                      <div className="health-history-heading">
                        <div>
                          <strong>Older operation records</strong>
                          <p>
                            {olderOperationCount} failed or unconfirmed operations are older than{' '}
                            {history?.windowHours ?? 24} hours. They remain available for review but
                            do not change the current platform status.
                          </p>
                        </div>
                        <Tag>{olderOperationCount} operations</Tag>
                      </div>
                      <OperationProjectLinks projects={history?.projects ?? []} window="older" />
                    </div>
                  ) : null}
                </div>
              ),
            },
            {
              key: 'queues',
              label: 'Background work',
              children: (
                <Table
                  dataSource={Object.entries(snapshot?.queues ?? {}).map(([name, counts]) => ({
                    name,
                    ...counts,
                  }))}
                  pagination={false}
                  rowKey="name"
                  scroll={{ x: 720 }}
                  columns={[
                    {
                      dataIndex: 'name',
                      render: (value: string) => <strong>{queueLabel(value)}</strong>,
                      title: 'Work type',
                    },
                    { dataIndex: 'active', title: 'Running now' },
                    { dataIndex: 'waiting', title: 'Waiting' },
                    { dataIndex: 'delayed', title: 'Scheduled for later' },
                    {
                      dataIndex: 'failed',
                      render: (value: number) => (
                        <Tag color={value ? 'red' : 'default'}>{value}</Tag>
                      ),
                      title: 'Need attention',
                    },
                  ]}
                />
              ),
            },
            {
              key: 'audit',
              label: 'Account activity',
              children: (
                <Table<GlobalAudit>
                  dataSource={audit.data?.items ?? []}
                  loading={audit.isLoading}
                  pagination={{
                    current: auditPage,
                    onChange: setAuditPage,
                    pageSize: 50,
                    showSizeChanger: false,
                    total: audit.data?.total ?? 0,
                  }}
                  rowKey="id"
                  scroll={{ x: 980 }}
                  columns={[
                    {
                      dataIndex: 'action',
                      render: (value) => <strong>{humanizeAuditAction(value)}</strong>,
                      title: 'What happened',
                    },
                    {
                      dataIndex: 'actorEmailSnapshot',
                      render: (value, row) => value ?? humanizeEntity(row.actorType),
                      title: 'Who',
                    },
                    {
                      dataIndex: 'projectNameSnapshot',
                      render: (value) => value ?? 'Entire system',
                      title: 'Where',
                    },
                    {
                      dataIndex: 'entityType',
                      render: (value) => humanizeEntity(value),
                      title: 'Item',
                    },
                    {
                      dataIndex: 'reason',
                      render: (value) => humanizeReason(value),
                      title: 'Why',
                    },
                    {
                      dataIndex: 'createdAt',
                      render: (value) => new Date(value).toLocaleString(),
                      title: 'When',
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>
    </section>
  );
}

function OperationProjectLinks({
  alertCode,
  projects,
  window,
}: {
  alertCode?: string;
  projects: ProjectOperationHistory[];
  window: 'older' | 'recent';
}) {
  const links = projects.flatMap((project) => {
    const failed = window === 'recent' ? project.recentFailed : project.olderFailed;
    const inbox = window === 'recent' ? project.recentInbox : project.olderInbox;
    const unknown = window === 'recent' ? project.recentUnknown : project.olderUnknown;
    const candidates = [
      {
        count: failed,
        key: 'failed',
        label: 'failed',
        query: 'source=OUTBOX&status=FAILED',
        visible: !alertCode || alertCode === 'OUTBOX_FAILED',
      },
      {
        count: unknown,
        key: 'unknown',
        label: 'unconfirmed',
        query: 'source=OUTBOX&status=UNKNOWN',
        visible: !alertCode || alertCode === 'OUTBOX_UNKNOWN',
      },
      {
        count: inbox,
        key: 'inbox',
        label: 'incoming',
        query: 'source=INBOX',
        visible: !alertCode || alertCode === 'INBOX_TERMINAL',
      },
    ];
    return candidates
      .filter((candidate) => candidate.visible && candidate.count > 0)
      .map((candidate) => ({ ...candidate, project }));
  });
  if (!links.length) return null;
  return (
    <div className="health-project-links">
      {links.map(({ count, key, label, project, query }) => (
        <Link
          key={`${project.projectId}-${key}`}
          to={`/projects/${project.projectId}/operations?${query}`}
        >
          <span>{project.projectName}</span>
          <b>
            {count} {label}
          </b>
        </Link>
      ))}
    </div>
  );
}

function overallStatusLabel(status: Snapshot['overallStatus'] | undefined): string {
  if (!status) return 'Checking the platform…';
  if (status === 'HEALTHY') return 'Everything is working normally';
  if (status === 'ATTENTION') return 'A few items need attention';
  return 'Some services need attention';
}

function healthCountLabel(code: string, count: number): string {
  if (code === 'CHANNEL_ERROR') return `${count} channels`;
  if (code === 'CRM_ERROR') return `${count} connections`;
  if (code === 'PASSWORD_RESET_REQUESTS') return `${count} requests`;
  if (code.startsWith('QUEUE_')) return `${count} jobs`;
  return `${count} operations`;
}

function overallStatusDescription(status: Snapshot['overallStatus'] | undefined): string {
  if (!status) return 'Live checks are still running.';
  if (status === 'HEALTHY') return 'No service interruptions or blocked operations were detected.';
  if (status === 'ATTENTION')
    return 'The platform is available, but an operator should review the alerts below.';
  return 'The platform is available, but one or more important checks or operations require review.';
}

function dependencyLabel(name: string): string {
  const labels: Record<string, string> = {
    database: 'Data storage',
    redis: 'Queue service',
    worker: 'Background processing',
  };
  return labels[name] ?? 'Platform service';
}

function dependencyIcon(name: string) {
  if (name === 'database') return <DatabaseOutlined />;
  if (name === 'redis') return <ApartmentOutlined />;
  return <CloudServerOutlined />;
}

function queueLabel(name: string): string {
  const labels: Record<string, string> = {
    inbound: 'Incoming Telegram updates',
    outbound: 'Outgoing Telegram actions',
    worker: 'Background health checks',
  };
  return labels[name] ?? 'Background work';
}

function humanizeHealthAlert(code: string, fallback: string): string {
  const labels: Record<string, string> = {
    DATABASE_UNAVAILABLE: 'Data storage is unavailable',
    REDIS_UNAVAILABLE: 'Background queueing is unavailable',
    WORKER_UNAVAILABLE: 'Background processing is unavailable',
    CHANNEL_ERROR: 'One or more channels need attention',
    CRM_ERROR: 'One or more CRM connections need attention',
    INBOX_TERMINAL: 'Some incoming updates could not be processed',
    OUTBOX_FAILED: 'Some outgoing actions failed',
    OUTBOX_UNKNOWN: 'Some outgoing results need confirmation',
    PASSWORD_RESET_REQUESTS: 'Password reset requests are waiting',
  };
  if (code.startsWith('QUEUE_FAILED_')) return 'Some background work could not be completed';
  if (code.startsWith('QUEUE_BACKLOG_')) return 'Background work is taking longer than usual';
  return labels[code] ?? fallback.replaceAll('BullMQ', 'background');
}

function humanizeHealthDescription(code: string, fallback: string): string {
  const descriptions: Record<string, string> = {
    DATABASE_UNAVAILABLE: 'The platform cannot reach its data storage. Check the database service.',
    REDIS_UNAVAILABLE:
      'Scheduled and queued work is temporarily unavailable. Check the queue service.',
    WORKER_UNAVAILABLE:
      'Background tasks are not responding. Check the worker service and restart it if needed.',
    CHANNEL_ERROR: 'Open the affected project and review its channel connection.',
    CRM_ERROR: 'Open the affected project and review its CRM connection.',
    INBOX_TERMINAL: 'Open the project Operations page to review the affected updates safely.',
    OUTBOX_FAILED:
      'Open the project Operations page to see the reason and available recovery action.',
    OUTBOX_UNKNOWN: 'Confirm the provider result in Operations before attempting another action.',
    PASSWORD_RESET_REQUESTS: 'Open Users to create the requested one-time reset links.',
  };
  if (code.startsWith('QUEUE_FAILED_'))
    return 'Open the relevant project Operations page to review and safely retry failed work.';
  if (code.startsWith('QUEUE_BACKLOG_'))
    return 'Check that background processing is online and working through the queue.';
  return descriptions[code] ?? fallback.replaceAll('BullMQ', 'background processing');
}
