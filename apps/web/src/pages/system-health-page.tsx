import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DatabaseOutlined,
  ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Col, Row, Table, Tabs, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

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
  overallStatus: 'ATTENTION' | 'DEGRADED' | 'HEALTHY';
  queues: Record<string, { active: number; delayed: number; failed: number; waiting: number }>;
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
        <Typography.Text type="secondary">
          Updated {snapshot ? new Date(snapshot.generatedAt).toLocaleString() : '—'}
        </Typography.Text>
      </Card>
      <Row gutter={[16, 16]}>
        {Object.entries(snapshot?.dependencies ?? {}).map(([name, dependency]) => (
          <Col key={name} lg={8} xs={24}>
            <Card className="health-dependency-card">
              <div className="health-dependency-heading">
                <span>
                  <DatabaseOutlined />
                </span>
                <Typography.Text>{dependencyLabel(name)}</Typography.Text>
                <i className={dependency.status === 'up' ? 'is-up' : 'is-down'} />
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
      <Tabs
        items={[
          {
            key: 'alerts',
            label: `Alerts (${snapshot?.alerts.length ?? 0})`,
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
                      <div>
                        <strong>{humanizeHealthAlert(item.code, item.title)}</strong>
                        <p>{humanizeHealthDescription(item.code, item.description)}</p>
                      </div>
                      {item.count === undefined ? null : <Tag>{item.count} affected</Tag>}
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
                    render: (value: number) => <Tag color={value ? 'red' : 'default'}>{value}</Tag>,
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
    </section>
  );
}

function overallStatusLabel(status: Snapshot['overallStatus'] | undefined): string {
  if (!status) return 'Checking the platform…';
  if (status === 'HEALTHY') return 'Everything is working normally';
  if (status === 'ATTENTION') return 'A few items need attention';
  return 'Some services need attention';
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
    CHANNEL_ERROR: 'One or more channels need attention',
    CRM_ERROR: 'One or more CRM connections need attention',
    INBOX_TERMINAL: 'Some incoming updates could not be processed',
    OUTBOX_FAILED: 'Some outgoing actions failed',
    OUTBOX_UNKNOWN: 'Some outgoing results need confirmation',
    PASSWORD_RESET_REQUESTS: 'Password reset requests are waiting',
  };
  return labels[code] ?? fallback.replaceAll('BullMQ', 'background');
}

function humanizeHealthDescription(code: string, fallback: string): string {
  const descriptions: Record<string, string> = {
    CHANNEL_ERROR: 'Open the affected project and review its channel connection.',
    CRM_ERROR: 'Open the affected project and review its CRM connection.',
    INBOX_TERMINAL: 'Open the project Operations page to review the affected updates safely.',
    OUTBOX_FAILED:
      'Open the project Operations page to see the reason and available recovery action.',
    OUTBOX_UNKNOWN: 'Confirm the provider result in Operations before attempting another action.',
    PASSWORD_RESET_REQUESTS: 'Open Users to create the requested one-time reset links.',
  };
  return descriptions[code] ?? fallback.replaceAll('BullMQ', 'background processing');
}
