import { Alert, Button, Card, Col, Row, Statistic, Table, Tabs, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { apiRequest, getUserErrorMessage } from '../api';
import { useAuth } from '../auth';

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
            Live platform dependencies, queues and actionable alerts. No customer payload is
            exposed. No Sentry dependency is required.
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
        <div>
          <Typography.Text type="secondary">Platform status</Typography.Text>
          <Typography.Title level={3}>{snapshot?.overallStatus ?? 'Loading…'}</Typography.Title>
        </div>
        <Typography.Text type="secondary">
          Updated {snapshot ? new Date(snapshot.generatedAt).toLocaleString() : '—'}
        </Typography.Text>
      </Card>
      <Row gutter={[16, 16]}>
        {Object.entries(snapshot?.dependencies ?? {}).map(([name, dependency]) => (
          <Col key={name} lg={8} xs={24}>
            <Card className="health-dependency-card">
              <Statistic
                title={name.toLocaleUpperCase('en-US')}
                value={dependency.status === 'up' ? 'Online' : 'Unavailable'}
              />
              <Tag color={dependency.status === 'up' ? 'green' : 'red'}>
                {dependency.latencyMs === undefined
                  ? dependency.status
                  : `${dependency.latencyMs} ms`}
              </Tag>
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
                    <Alert
                      key={item.code}
                      description={item.description}
                      message={
                        <span>
                          {item.title}
                          {item.count === undefined ? '' : ` · ${item.count}`}
                        </span>
                      }
                      showIcon
                      type={item.severity === 'CRITICAL' ? 'error' : 'warning'}
                    />
                  ))
                ) : (
                  <Alert message="No active platform alerts" showIcon type="success" />
                )}
              </div>
            ),
          },
          {
            key: 'queues',
            label: 'Queues',
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
                    render: (value: string) => <strong>{value}</strong>,
                    title: 'Queue',
                  },
                  { dataIndex: 'active', title: 'Active' },
                  { dataIndex: 'waiting', title: 'Waiting' },
                  { dataIndex: 'delayed', title: 'Delayed' },
                  {
                    dataIndex: 'failed',
                    render: (value: number) => <Tag color={value ? 'red' : 'default'}>{value}</Tag>,
                    title: 'Failed',
                  },
                ]}
              />
            ),
          },
          {
            key: 'audit',
            label: 'Global audit',
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
                  { dataIndex: 'action', title: 'Action' },
                  {
                    dataIndex: 'actorEmailSnapshot',
                    render: (value, row) => value ?? row.actorType,
                    title: 'Actor',
                  },
                  {
                    dataIndex: 'projectNameSnapshot',
                    render: (value) => value ?? 'System',
                    title: 'Scope',
                  },
                  { dataIndex: 'entityType', title: 'Entity' },
                  { dataIndex: 'reason', render: (value) => value ?? '—', title: 'Reason' },
                  {
                    dataIndex: 'createdAt',
                    render: (value) => new Date(value).toLocaleString(),
                    title: 'Time',
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
