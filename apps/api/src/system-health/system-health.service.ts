import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@omnicus/config/server';
import {
  TELEGRAM_INBOUND_QUEUE_NAME,
  TELEGRAM_OUTBOUND_QUEUE_NAME,
} from '@omnicus/channel-telegram';
import { Queue, QueueEvents } from 'bullmq';
import { randomUUID } from 'node:crypto';

import { AuditService } from '../audit/audit.service';
import type { RequestSecurityContext } from '../auth/auth.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { AuditQueryDto } from '../operations/dto';
import { DatabaseService } from '../database/database.service';
import { DatabaseHealthService } from '../health/database-health.service';
import { RedisHealthService } from '../health/redis-health.service';
import { redisConnectionFromUrl } from '../telegram-webhook/telegram-redis-connection';

const systemHealthQueueName = 'system-health';
const systemHealthJobName = 'demo-job';

type Severity = 'CRITICAL' | 'WARNING';

interface HealthAlert {
  code: string;
  count?: number;
  description: string;
  severity: Severity;
  title: string;
}

function within<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('system_health_probe_timeout')), timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('system_health_probe_failed'));
      },
    );
  });
}

@Injectable()
export class SystemHealthService implements OnApplicationShutdown {
  private queues?: Record<string, Queue>;
  private events?: QueueEvents;

  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<ApiEnvironment, true>,
    @Inject(DatabaseHealthService) private readonly databaseHealth: DatabaseHealthService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RedisHealthService) private readonly redisHealth: RedisHealthService,
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  private queueClients(): { events: QueueEvents; queues: Record<string, Queue> } {
    if (this.queues && this.events) return { events: this.events, queues: this.queues };
    const connection = {
      ...redisConnectionFromUrl(this.config.get('REDIS_URL', { infer: true })),
      maxRetriesPerRequest: 1,
    };
    this.queues = {
      inbound: new Queue(TELEGRAM_INBOUND_QUEUE_NAME, { connection }),
      outbound: new Queue(TELEGRAM_OUTBOUND_QUEUE_NAME, { connection }),
      worker: new Queue(systemHealthQueueName, { connection }),
    };
    this.events = new QueueEvents(systemHealthQueueName, {
      connection: { ...connection, maxRetriesPerRequest: null },
    });
    return { events: this.events, queues: this.queues };
  }

  async snapshot() {
    const [database, redis, worker, queues, aggregates] = await Promise.all([
      this.dependency(() => this.databaseHealth.check()),
      this.dependency(() => this.redisHealth.check()),
      this.workerProbe(),
      this.queueCounts(),
      this.safeAggregates(),
    ]);
    const alerts: HealthAlert[] = [];
    if (database.status === 'down')
      alerts.push({
        code: 'DATABASE_UNAVAILABLE',
        description: 'The API could not complete a PostgreSQL health check.',
        severity: 'CRITICAL',
        title: 'Database is unavailable',
      });
    if (redis.status === 'down')
      alerts.push({
        code: 'REDIS_UNAVAILABLE',
        description: 'Queue scheduling and recovery signals cannot reach Redis.',
        severity: 'CRITICAL',
        title: 'Redis is unavailable',
      });
    if (worker.status === 'down')
      alerts.push({
        code: 'WORKER_UNAVAILABLE',
        description: 'A bounded BullMQ round-trip did not complete through the worker.',
        severity: 'CRITICAL',
        title: 'Worker is unavailable',
      });
    for (const [queueName, counts] of Object.entries(queues)) {
      if (counts.failed > 0)
        alerts.push({
          code: `QUEUE_FAILED_${queueName.toLocaleUpperCase('en-US')}`,
          count: counts.failed,
          description: `${counts.failed} failed BullMQ job(s) require operational review.`,
          severity: counts.failed >= 10 ? 'CRITICAL' : 'WARNING',
          title: `${queueName} queue has failed jobs`,
        });
      if (counts.waiting >= 100)
        alerts.push({
          code: `QUEUE_BACKLOG_${queueName.toLocaleUpperCase('en-US')}`,
          count: counts.waiting,
          description: `${counts.waiting} jobs are waiting; confirm worker throughput.`,
          severity: counts.waiting >= 1_000 ? 'CRITICAL' : 'WARNING',
          title: `${queueName} queue backlog`,
        });
    }
    if (aggregates) {
      this.aggregateAlert(
        alerts,
        'INBOX_TERMINAL',
        aggregates.inboxTerminal,
        'Inbound events need attention',
      );
      this.aggregateAlert(
        alerts,
        'OUTBOX_FAILED',
        aggregates.outboxFailed,
        'Outbound operations failed',
      );
      this.aggregateAlert(
        alerts,
        'OUTBOX_UNKNOWN',
        aggregates.outboxUnknown,
        'Outbound results are unknown',
        true,
      );
      this.aggregateAlert(
        alerts,
        'CHANNEL_ERROR',
        aggregates.channelErrors,
        'Channels are in an error state',
        true,
      );
      this.aggregateAlert(
        alerts,
        'CRM_ERROR',
        aggregates.crmErrors,
        'CRM connections are in an error state',
        true,
      );
      if (aggregates.passwordResetRequests24h > 0)
        alerts.push({
          code: 'PASSWORD_RESET_REQUESTS',
          count: aggregates.passwordResetRequests24h,
          description: 'Review recent requests and generate reset links from Users.',
          severity: 'WARNING',
          title: 'Password reset requests are waiting for an operator',
        });
    }
    return {
      alerts,
      dependencies: { database, redis, worker },
      generatedAt: new Date().toISOString(),
      operationCounts: aggregates,
      operationHistory: aggregates?.operationHistory ?? null,
      overallStatus: alerts.some((alert) => alert.severity === 'CRITICAL')
        ? 'DEGRADED'
        : alerts.length
          ? 'ATTENTION'
          : 'HEALTHY',
      queues,
    };
  }

  async audit(query: AuditQueryDto) {
    const createdAt =
      query.from || query.to
        ? {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          }
        : undefined;
    const where = {
      ...(createdAt ? { createdAt } : {}),
      ...(query.action ? { action: { contains: query.action, mode: 'insensitive' as const } } : {}),
      ...(query.correlationId ? { correlationId: { contains: query.correlationId } } : {}),
    };
    const [items, total] = await Promise.all([
      this.database.client.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          action: true,
          actorEmailSnapshot: true,
          actorType: true,
          afterSafeJson: true,
          beforeSafeJson: true,
          correlationId: true,
          createdAt: true,
          entityId: true,
          entityType: true,
          id: true,
          projectId: true,
          projectNameSnapshot: true,
          reason: true,
        },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        where,
      }),
      this.database.client.auditLog.count({ where }),
    ]);
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  async reset(actor: AuthenticatedUser, context: RequestSecurityContext) {
    const resetAt = new Date();
    await this.auditService.record({
      action: 'system.health.reset',
      actorEmailSnapshot: actor.email,
      actorUserId: actor.userId,
      afterSafeJson: { resetAt: resetAt.toISOString() },
      correlationId: context.correlationId,
      entityId: 'global',
      entityType: 'SystemHealth',
      ip: context.ip,
      reason: 'Operational statistics acknowledged by an administrator',
      userAgent: context.userAgent,
    });
    return { resetAt: resetAt.toISOString() };
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.queues || !this.events) return;
    await Promise.allSettled([
      ...Object.values(this.queues).map((queue) => queue.close()),
      this.events.close(),
    ]);
  }

  private async dependency(check: () => Promise<{ latencyMs?: number; status: 'down' | 'up' }>) {
    try {
      return await check();
    } catch {
      return { status: 'down' as const };
    }
  }

  private async workerProbe() {
    const startedAt = performance.now();
    try {
      const { events, queues } = this.queueClients();
      await within(events.waitUntilReady(), 2_500);
      const requestedAt = new Date().toISOString();
      const job = await queues.worker!.add(
        systemHealthJobName,
        { requestedAt },
        { jobId: `api-health-${randomUUID()}`, removeOnComplete: true, removeOnFail: true },
      );
      const result = (await job.waitUntilFinished(events, 5_000)) as {
        requestedAt?: string;
        status?: string;
      };
      if (result.status !== 'ok' || result.requestedAt !== requestedAt)
        throw new Error('worker_probe_invalid');
      return { latencyMs: Math.round(performance.now() - startedAt), status: 'up' as const };
    } catch {
      return { status: 'down' as const };
    }
  }

  private async queueCounts() {
    const { queues } = this.queueClients();
    const entries = await Promise.all(
      Object.entries(queues).map(async ([name, queue]) => {
        try {
          const counts = await within(
            queue.getJobCounts('active', 'delayed', 'failed', 'waiting'),
            2_500,
          );
          return [
            name,
            {
              active: counts.active ?? 0,
              delayed: counts.delayed ?? 0,
              failed: counts.failed ?? 0,
              waiting: counts.waiting ?? 0,
            },
          ] as const;
        } catch {
          return [name, { active: 0, delayed: 0, failed: 0, waiting: 0 }] as const;
        }
      }),
    );
    return Object.fromEntries(entries) as Record<
      string,
      { active: number; delayed: number; failed: number; waiting: number }
    >;
  }

  private async safeAggregates() {
    try {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1_000);
      const latestReset = await this.database.client.auditLog.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
        where: { action: 'system.health.reset' },
      });
      const resetAt = latestReset?.createdAt;
      const recentSince = resetAt && resetAt > since24h ? resetAt : since24h;
      const afterReset = resetAt ? { updatedAt: { gt: resetAt } } : {};
      const [
        inboxTerminalAllByProject,
        inboxTerminalRecentByProject,
        outboxTerminalAllByProject,
        outboxTerminalRecentByProject,
        channelErrors,
        crmErrors,
        passwordResetRequests,
        passwordResetLinks,
      ] = await Promise.all([
        this.database.client.inboxRecord.groupBy({
          _count: { _all: true },
          by: ['projectId', 'status'],
          where: { ...afterReset, status: { in: ['DEAD_LETTER', 'FAILED'] } },
        }),
        this.database.client.inboxRecord.groupBy({
          _count: { _all: true },
          by: ['projectId', 'status'],
          where: {
            status: { in: ['DEAD_LETTER', 'FAILED'] },
            updatedAt: { gte: recentSince },
          },
        }),
        this.database.client.outboxRecord.groupBy({
          _count: { _all: true },
          by: ['projectId', 'status'],
          where: { ...afterReset, status: { in: ['FAILED', 'UNKNOWN'] } },
        }),
        this.database.client.outboxRecord.groupBy({
          _count: { _all: true },
          by: ['projectId', 'status'],
          where: { status: { in: ['FAILED', 'UNKNOWN'] }, updatedAt: { gte: recentSince } },
        }),
        this.database.client.channelConnection.count({ where: { status: 'ERROR' } }),
        this.database.client.crmProjectConfig.count({ where: { status: 'ERROR' } }),
        this.database.client.auditLog.findMany({
          select: { createdAt: true, entityId: true },
          where: { action: 'auth.password_reset.requested', createdAt: { gte: since24h } },
        }),
        this.database.client.auditLog.findMany({
          select: { createdAt: true, entityId: true },
          where: { action: 'auth.password_reset.link_created', createdAt: { gte: since24h } },
        }),
      ]);
      const passwordResetRequests24h = passwordResetRequests.filter(
        (request) =>
          !passwordResetLinks.some(
            (link) =>
              link.entityId === request.entityId &&
              link.createdAt.getTime() >= request.createdAt.getTime(),
          ),
      ).length;
      const terminalRows = [...inboxTerminalAllByProject, ...outboxTerminalAllByProject];
      const projectIds = [...new Set(terminalRows.map((row) => row.projectId))];
      const projects = projectIds.length
        ? await this.database.client.project.findMany({
            select: { id: true, name: true },
            where: { id: { in: projectIds } },
          })
        : [];
      const projectNames = new Map(projects.map((project) => [project.id, project.name]));
      const count = (
        rows: ReadonlyArray<{ _count: { _all: number }; projectId: string; status: string }>,
        status?: string,
        projectId?: string,
      ) =>
        rows.reduce(
          (total, row) =>
            total +
            (status && row.status !== status
              ? 0
              : projectId && row.projectId !== projectId
                ? 0
                : row._count._all),
          0,
        );
      const inboxTerminal = count(inboxTerminalRecentByProject);
      const outboxFailed = count(outboxTerminalRecentByProject, 'FAILED');
      const outboxUnknown = count(outboxTerminalRecentByProject, 'UNKNOWN');
      const operationHistory = {
        older: {
          inboxTerminal: Math.max(0, count(inboxTerminalAllByProject) - inboxTerminal),
          outboxFailed: Math.max(0, count(outboxTerminalAllByProject, 'FAILED') - outboxFailed),
          outboxUnknown: Math.max(0, count(outboxTerminalAllByProject, 'UNKNOWN') - outboxUnknown),
        },
        projects: projectIds
          .map((projectId) => {
            const recentInbox = count(inboxTerminalRecentByProject, undefined, projectId);
            const recentFailed = count(outboxTerminalRecentByProject, 'FAILED', projectId);
            const recentUnknown = count(outboxTerminalRecentByProject, 'UNKNOWN', projectId);
            return {
              olderFailed: Math.max(
                0,
                count(outboxTerminalAllByProject, 'FAILED', projectId) - recentFailed,
              ),
              olderInbox: Math.max(
                0,
                count(inboxTerminalAllByProject, undefined, projectId) - recentInbox,
              ),
              olderUnknown: Math.max(
                0,
                count(outboxTerminalAllByProject, 'UNKNOWN', projectId) - recentUnknown,
              ),
              projectId,
              projectName: projectNames.get(projectId) ?? 'Unavailable project',
              recentFailed,
              recentInbox,
              recentUnknown,
            };
          })
          .sort((left, right) => left.projectName.localeCompare(right.projectName)),
        recent: { inboxTerminal, outboxFailed, outboxUnknown },
        windowHours: 24,
      };
      return {
        channelErrors,
        crmErrors,
        inboxTerminal,
        operationHistory,
        outboxFailed,
        outboxUnknown,
        passwordResetRequests24h,
      };
    } catch {
      return null;
    }
  }

  private aggregateAlert(
    alerts: HealthAlert[],
    code: string,
    count: number,
    title: string,
    critical = false,
  ) {
    if (count <= 0) return;
    alerts.push({
      code,
      count,
      description: 'Open Operations to inspect safe diagnostics and the permitted recovery action.',
      severity: critical ? 'CRITICAL' : 'WARNING',
      title,
    });
  }
}
