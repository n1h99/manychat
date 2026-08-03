import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Grid,
  Input,
  Select,
  Space,
  Table,
  Timeline,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  RightOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';

import {
  type AutomationActivityFilters,
  type AutomationActivitySnapshot,
  type AutomationActivityStatus,
  useAutomationActivity,
  useScenarios,
} from '../automation-api';
import { getUserErrorMessage } from '../api';
import { StatusText } from '../status-text';

type ActivityItem = AutomationActivitySnapshot['items'][number];

const statusOptions: Array<{ label: string; value: AutomationActivityStatus }> = [
  { label: 'Starting', value: 'QUEUED' },
  { label: 'In progress', value: 'RUNNING' },
  { label: 'Waiting', value: 'WAITING' },
  { label: 'Paused for review', value: 'PAUSED' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Needs attention', value: 'FAILED' },
  { label: 'Stopped', value: 'CANCELLED' },
];

export function AutomationActivityPage() {
  const { projectId } = useParams();
  const screens = Grid.useBreakpoint();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ActivityItem>();
  const [filters, setFilters] = useState<AutomationActivityFilters>({
    page: 1,
    pageSize: 25,
    periodDays: 30,
    query: undefined,
    scenarioId: undefined,
    status: undefined,
  });
  const activity = useAutomationActivity(projectId, filters);
  const scenarios = useScenarios(projectId);
  const data = activity.data;

  return (
    <section className="automation-activity-page">
      <div className="page-heading-row">
        <div>
          <Typography.Title level={2}>Automation activity</Typography.Title>
          <Typography.Text type="secondary">
            See where every contact is, what happened, and why a run stopped or needs attention.
          </Typography.Text>
        </div>
        <Button
          icon={<ReloadOutlined />}
          loading={activity.isFetching}
          onClick={() => void activity.refetch()}
        >
          Refresh
        </Button>
      </div>

      {activity.isError ? (
        <Alert
          message={getUserErrorMessage(
            activity.error,
            'Automation activity could not be loaded. Please try again.',
          )}
          showIcon
          type="error"
        />
      ) : null}

      <Card className="activity-filter-card">
        <Input.Search
          allowClear
          onChange={(event) => setSearch(event.target.value)}
          onSearch={(query) =>
            setFilters((current) => ({ ...current, page: 1, query: query || undefined }))
          }
          placeholder="Search by contact or automation"
          value={search}
        />
        <Select
          allowClear
          loading={scenarios.isLoading}
          onChange={(scenarioId) => setFilters((current) => ({ ...current, page: 1, scenarioId }))}
          options={(scenarios.data ?? []).map((scenario) => ({
            label: scenario.name,
            value: scenario.id,
          }))}
          placeholder="All automations"
          value={filters.scenarioId ?? null}
        />
        <Select
          allowClear
          onChange={(status) => setFilters((current) => ({ ...current, page: 1, status }))}
          options={statusOptions}
          placeholder="All statuses"
          value={filters.status ?? null}
        />
        <Select
          onChange={(periodDays: 7 | 30 | 90) =>
            setFilters((current) => ({ ...current, page: 1, periodDays }))
          }
          options={[
            { label: 'Last 7 days', value: 7 },
            { label: 'Last 30 days', value: 30 },
            { label: 'Last 90 days', value: 90 },
          ]}
          value={filters.periodDays}
        />
      </Card>

      <ActivitySummary summary={data?.summary} />

      <div className="activity-insights-grid">
        <Card className="activity-chart-card" title="Runs over time">
          <ActivityTrend trend={data?.trend ?? []} />
          {data?.trendSampled ? (
            <Typography.Text className="chart-sample-note" type="secondary">
              The chart uses the most recent 2,000 matching runs. The totals above remain exact.
            </Typography.Text>
          ) : null}
        </Card>
        <Card className="activity-chart-card" title="Current outcomes">
          <StatusDonut statuses={data?.breakdown.statuses ?? []} total={data?.summary.total ?? 0} />
        </Card>
      </div>

      <div className="activity-insights-grid activity-insights-grid--lower">
        <Card className="activity-chart-card" title="Most active automations">
          <ScenarioBars scenarios={data?.breakdown.scenarios ?? []} />
        </Card>
        <Card className="activity-chart-card" title="Why runs stopped or paused">
          <ReasonList reasons={data?.breakdown.reasons ?? []} />
        </Card>
      </div>

      <Card className="activity-table-card" title="Contact journeys">
        <Table<ActivityItem>
          columns={[
            {
              render: (_, row) => (
                <div className="activity-contact-cell">
                  <strong>{contactName(row)}</strong>
                  <small>
                    {row.contact.email ??
                      row.contact.phone ??
                      row.contact.username ??
                      'No contact details'}
                  </small>
                </div>
              ),
              title: 'Contact',
              width: 230,
            },
            {
              render: (_, row) => (
                <div className="activity-automation-cell">
                  <strong>{row.scenario.name}</strong>
                  <small>Version {row.scenario.version}</small>
                </div>
              ),
              title: 'Automation',
              width: 220,
            },
            {
              render: (_, row) => <StatusText label={row.statusLabel} status={row.status} />,
              title: 'Status',
              width: 145,
            },
            {
              render: (_, row) => row.currentStep?.label ?? 'No active step',
              title: 'Current step',
              width: 170,
            },
            {
              dataIndex: 'reason',
              ellipsis: true,
              title: 'What happened',
            },
            {
              render: (_, row) => new Date(row.updatedAt).toLocaleString(),
              title: 'Last activity',
              width: 180,
            },
            {
              align: 'right',
              render: (_, row) => (
                <Button
                  aria-label={`Open activity for ${contactName(row)}`}
                  icon={<RightOutlined />}
                  onClick={() => setSelected(row)}
                  type="text"
                />
              ),
              title: '',
              width: 56,
            },
          ]}
          dataSource={data?.items ?? []}
          loading={activity.isLoading}
          locale={{ emptyText: <Empty description="No automation runs match these filters" /> }}
          onRow={(row) => ({ className: 'clickable-table-row', onClick: () => setSelected(row) })}
          pagination={{
            current: filters.page,
            onChange: (page, pageSize) => setFilters((current) => ({ ...current, page, pageSize })),
            pageSize: filters.pageSize,
            showSizeChanger: true,
            total: data?.total ?? 0,
          }}
          rowKey="id"
          {...(screens.lg === false ? { scroll: { x: 1_050 } } : {})}
        />
      </Card>

      <ActivityDrawer
        item={selected}
        onClose={() => setSelected(undefined)}
        projectId={projectId}
      />
    </section>
  );
}

function ActivitySummary({
  summary,
}: {
  summary: AutomationActivitySnapshot['summary'] | undefined;
}) {
  const cards = [
    { className: 'is-total', label: 'All runs', value: summary?.total ?? 0 },
    { className: 'is-active', label: 'In progress', value: summary?.active ?? 0 },
    { className: 'is-waiting', label: 'Waiting or paused', value: summary?.waiting ?? 0 },
    { className: 'is-complete', label: 'Completed', value: summary?.completed ?? 0 },
    { className: 'is-problem', label: 'Need attention', value: summary?.problems ?? 0 },
  ];
  return (
    <div className="activity-summary-grid">
      {cards.map((card) => (
        <Card className={`activity-summary-card ${card.className}`} key={card.label}>
          <span>{card.label}</span>
          <strong>{card.value}</strong>
        </Card>
      ))}
    </div>
  );
}

function ActivityTrend({ trend }: { trend: AutomationActivitySnapshot['trend'] }) {
  const maximum = Math.max(1, ...trend.map((item) => item.started));
  if (!trend.some((item) => item.started)) return <Empty description="No runs in this period" />;
  const labelEvery = Math.max(1, Math.ceil(trend.length / 7));
  return (
    <div>
      <div className="activity-chart-legend">
        <span>
          <i className="is-started" />
          Started
        </span>
        <span>
          <i className="is-completed" />
          Completed
        </span>
        <span>
          <i className="is-problem" />
          Need attention
        </span>
      </div>
      <div className="activity-trend-chart">
        {trend.map((item, index) => (
          <div className="activity-trend-column" key={item.date}>
            <div className="activity-trend-bars">
              <span
                className="is-started"
                style={{ height: `${(item.started / maximum) * 100}%` }}
              />
              <span
                className="is-completed"
                style={{ height: `${(item.completed / maximum) * 100}%` }}
              />
              <span
                className="is-problem"
                style={{ height: `${(item.problems / maximum) * 100}%` }}
              />
            </div>
            <small>
              {index % labelEvery === 0
                ? new Date(`${item.date}T00:00:00Z`).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                  })
                : ''}
            </small>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusDonut({
  statuses,
  total,
}: {
  statuses: AutomationActivitySnapshot['breakdown']['statuses'];
  total: number;
}) {
  const colors: Record<AutomationActivityStatus, string> = {
    CANCELLED: '#94a3b8',
    COMPLETED: '#22a06b',
    FAILED: '#e45858',
    PAUSED: '#eaa23a',
    QUEUED: '#58a6d8',
    RUNNING: '#16877f',
    WAITING: '#d8b64f',
  };
  const gradient = useMemo(() => {
    if (!total) return '#edf2f7';
    let start = 0;
    const segments = statuses.map((item) => {
      const end = start + (item.count / total) * 100;
      const segment = `${colors[item.status]} ${start}% ${end}%`;
      start = end;
      return segment;
    });
    return `conic-gradient(${segments.join(', ')})`;
  }, [statuses, total]);
  return (
    <div className="activity-donut-layout">
      <div className="activity-donut" style={{ background: gradient }}>
        <div>
          <strong>{total}</strong>
          <span>runs</span>
        </div>
      </div>
      <div className="activity-donut-legend">
        {statuses.length ? (
          statuses.map((item) => (
            <div key={item.status}>
              <i style={{ background: colors[item.status] }} />
              <span>{item.label}</span>
              <strong>{item.count}</strong>
            </div>
          ))
        ) : (
          <Empty description="No outcomes yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </div>
    </div>
  );
}

function ScenarioBars({
  scenarios,
}: {
  scenarios: AutomationActivitySnapshot['breakdown']['scenarios'];
}) {
  const maximum = Math.max(1, ...scenarios.map((item) => item.total));
  if (!scenarios.length) return <Empty description="No automation runs yet" />;
  return (
    <div className="scenario-bar-list">
      {scenarios.map((scenario) => (
        <div className="scenario-bar-item" key={scenario.id}>
          <div>
            <strong>{scenario.name}</strong>
            <span>{scenario.total} runs</span>
          </div>
          <div className="scenario-bar-track">
            <span style={{ width: `${(scenario.total / maximum) * 100}%` }} />
          </div>
          <small>
            {scenario.completed} completed · {scenario.active} active · {scenario.problems} need
            attention
          </small>
        </div>
      ))}
    </div>
  );
}

function ReasonList({ reasons }: { reasons: AutomationActivitySnapshot['breakdown']['reasons'] }) {
  if (!reasons.length)
    return (
      <div className="activity-all-clear">
        <CheckCircleOutlined />
        <strong>No stopped or paused runs in this view</strong>
        <span>Everything is moving normally.</span>
      </div>
    );
  const maximum = Math.max(...reasons.map((item) => item.count));
  return (
    <div className="activity-reason-list">
      {reasons.map((reason) => (
        <div key={reason.label}>
          <span>{reason.label}</span>
          <strong>{reason.count}</strong>
          <i>
            <b style={{ width: `${(reason.count / maximum) * 100}%` }} />
          </i>
        </div>
      ))}
    </div>
  );
}

function ActivityDrawer({
  item,
  onClose,
  projectId,
}: {
  item: ActivityItem | undefined;
  onClose(): void;
  projectId: string | undefined;
}) {
  return (
    <Drawer
      className="activity-detail-drawer"
      onClose={onClose}
      open={Boolean(item)}
      title="Contact journey"
      width={560}
    >
      {item ? (
        <>
          <div className="activity-detail-hero">
            <span className="activity-detail-icon">
              <ThunderboltOutlined />
            </span>
            <div>
              <Typography.Title level={4}>{contactName(item)}</Typography.Title>
              <Typography.Text>
                {item.scenario.name} · Version {item.scenario.version}
              </Typography.Text>
            </div>
            <StatusText label={item.statusLabel} status={item.status} />
          </div>
          <div className="activity-detail-facts">
            <div>
              <span>What happened</span>
              <strong>{item.reason}</strong>
            </div>
            <div>
              <span>Started</span>
              <strong>{new Date(item.createdAt).toLocaleString()}</strong>
            </div>
            <div>
              <span>Last activity</span>
              <strong>{new Date(item.updatedAt).toLocaleString()}</strong>
            </div>
            <div>
              <span>Time in automation</span>
              <strong>{formatDuration(item.durationMs)}</strong>
            </div>
          </div>
          <Space className="activity-detail-links" wrap>
            <Link to={`/projects/${projectId}/contacts/${item.contact.id}`}>Open contact</Link>
            <Link to={`/projects/${projectId}/scenarios/${item.scenario.id}`}>Open automation</Link>
          </Space>
          <Typography.Title level={5}>Journey timeline</Typography.Title>
          {item.timeline.length ? (
            <Timeline
              items={item.timeline.map((step) => ({
                color:
                  step.status === 'FAILED' ? 'red' : step.status === 'SUCCEEDED' ? 'green' : 'blue',
                children: (
                  <div className="activity-timeline-step">
                    <strong>{step.label}</strong>
                    <span>{stepStatusLabel(step.status)}</span>
                    {step.reason ? <small>{step.reason}</small> : null}
                    {step.startedAt ? (
                      <time>{new Date(step.startedAt).toLocaleString()}</time>
                    ) : null}
                  </div>
                ),
                dot:
                  step.status === 'FAILED' ? (
                    <ExclamationCircleOutlined />
                  ) : step.status === 'SUCCEEDED' ? (
                    <CheckCircleOutlined />
                  ) : (
                    <ClockCircleOutlined />
                  ),
              }))}
            />
          ) : (
            <Empty description="This run has not started its first step yet" />
          )}
        </>
      ) : null}
    </Drawer>
  );
}

function contactName(item: ActivityItem): string {
  return (
    item.contact.displayName ?? item.contact.username ?? item.contact.email ?? 'Unknown contact'
  );
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return 'Not started';
  const seconds = Math.floor(durationMs / 1_000);
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} days ${hours % 24} hr`;
}

function stepStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    FAILED: 'Needs attention',
    PENDING: 'Waiting to start',
    PROCESSING: 'In progress',
    SKIPPED: 'Skipped',
    SUCCEEDED: 'Completed',
  };
  return labels[status] ?? 'Recorded';
}
