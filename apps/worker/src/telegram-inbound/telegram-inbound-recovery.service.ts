import { randomUUID } from 'node:crypto';

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WorkerEnvironment } from '@omnicus/config/server';
import {
  TELEGRAM_INBOUND_JOB_NAME,
  TELEGRAM_INBOUND_QUEUE_NAME,
  telegramInboundJobIdFor,
  type TelegramInboundJob,
} from '@omnicus/channel-telegram';
import { Queue } from 'bullmq';

import { DatabaseService } from '../database/database.service';
import { redisConnectionFromUrl } from '../queue/redis-connection';

export const TELEGRAM_INBOUND_RECOVERY_QUEUE = Symbol('TELEGRAM_INBOUND_RECOVERY_QUEUE');

export interface TelegramInboundRecoveryQueue {
  add(
    name: string,
    data: TelegramInboundJob,
    options: {
      attempts: number;
      backoff: { delay: number; type: 'exponential' };
      jobId: string;
      removeOnComplete: boolean | number;
      removeOnFail: boolean | number;
    },
  ): Promise<unknown>;
  close(): Promise<void>;
  waitUntilReady?(): Promise<unknown>;
}

export interface ManualInboxRetryInput {
  actorUserId?: string;
  correlationId?: string;
  inboxRecordId: string;
  resetAttempts?: boolean;
}

export interface ManualInboxRetryResult {
  enqueued: boolean;
  inboxRecordId: string;
}

const queueOptions = (inboxRecordId: string) => ({
  attempts: 8,
  backoff: { delay: 1_000, type: 'exponential' as const },
  jobId: telegramInboundJobIdFor(inboxRecordId),
  removeOnComplete: true,
  removeOnFail: true,
});

@Injectable()
export class TelegramInboundRecoveryService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(TelegramInboundRecoveryService.name);
  private queue: TelegramInboundRecoveryQueue | undefined;
  private timer: NodeJS.Timeout | undefined;
  private scanning = false;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<WorkerEnvironment, true>,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Optional()
    @Inject(TELEGRAM_INBOUND_RECOVERY_QUEUE)
    queue?: TelegramInboundRecoveryQueue,
  ) {
    this.queue = queue;
  }

  async onApplicationBootstrap(): Promise<void> {
    const queue = this.getQueue();
    await queue.waitUntilReady?.();
    this.timer = setInterval(
      () => {
        void this.scanOnce();
      },
      this.config.get('TELEGRAM_INBOUND_RECOVERY_INTERVAL_MS', { infer: true }),
    );
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    try {
      await this.queue?.close();
    } catch {
      this.logger.warn({ message: 'Telegram inbound recovery queue shutdown failed' });
    }
  }

  async scanOnce(now = new Date()): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const leaseExpiry = new Date(
        now.getTime() - this.config.get('TELEGRAM_INBOUND_LEASE_MS', { infer: true }),
      );
      const records = await this.database.client.inboxRecord.findMany({
        orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, lockedAt: true, projectId: true, status: true },
        take: this.config.get('TELEGRAM_INBOUND_RECOVERY_BATCH_SIZE', { infer: true }),
        where: {
          OR: [
            { nextAttemptAt: { lte: now }, status: 'PENDING' },
            { nextAttemptAt: { lte: now }, status: 'RETRY' },
            { lockedAt: { lt: leaseExpiry }, status: 'PROCESSING' },
          ],
        },
      });
      this.logger.log({ count: records.length, message: 'inbox_recovery_scan' });

      for (const record of records) {
        let shouldEnqueue = record.status !== 'PROCESSING';
        if (record.status === 'PROCESSING') {
          const recovered = await this.database.client.inboxRecord.updateMany({
            data: {
              lastError: 'telegram_inbound_stale_lease_recovered',
              lockedAt: null,
              lockedBy: null,
              nextAttemptAt: now,
              status: 'RETRY',
            },
            where: {
              id: record.id,
              lockedAt: { lt: leaseExpiry },
              projectId: record.projectId,
              status: 'PROCESSING',
            },
          });
          shouldEnqueue = recovered.count === 1;
          if (shouldEnqueue) {
            this.logger.log({
              inboxRecordId: record.id,
              message: 'stale_lease_recovered',
              projectId: record.projectId,
            });
          }
        }
        if (shouldEnqueue) await this.enqueue(record.id, record.projectId, 'recovery');
      }
    } finally {
      this.scanning = false;
    }
  }

  async retryDeadLetter(input: ManualInboxRetryInput): Promise<ManualInboxRetryResult> {
    const now = new Date();
    const record = await this.database.client.inboxRecord.findUnique({
      where: { id: input.inboxRecordId },
    });
    if (!record || !['DEAD_LETTER', 'FAILED'].includes(record.status)) {
      throw new Error('Inbox record is not terminal and cannot be manually retried');
    }

    const updated = await this.database.client.inboxRecord.updateMany({
      data: {
        ...(input.resetAttempts ? { attempts: 0 } : {}),
        completedAt: null,
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt: now,
        status: 'RETRY',
      },
      where: {
        id: record.id,
        projectId: record.projectId,
        status: { in: ['DEAD_LETTER', 'FAILED'] },
      },
    });
    if (updated.count !== 1) {
      throw new Error('Inbox record changed before manual retry could be scheduled');
    }

    const project = await this.database.client.project.findUniqueOrThrow({
      select: { name: true, slug: true },
      where: { id: record.projectId },
    });

    await this.database.client.auditLog.create({
      data: {
        action: 'inbox.manual_retry_requested',
        actorType: input.actorUserId ? 'USER' : 'SYSTEM',
        ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
        afterSafeJson: { resetAttempts: input.resetAttempts === true },
        correlationId: input.correlationId ?? `manual-inbox-retry:${randomUUID()}`,
        entityId: record.id,
        entityType: 'InboxRecord',
        projectId: record.projectId,
        projectNameSnapshot: project.name,
        projectSlugSnapshot: project.slug,
        purgeAfter: new Date(now.getTime() + 180 * 24 * 60 * 60 * 1_000),
      },
    });

    const enqueued = await this.enqueue(record.id, record.projectId, 'manual_retry');
    return { enqueued, inboxRecordId: record.id };
  }

  private async enqueue(
    inboxRecordId: string,
    projectId: string,
    source: 'manual_retry' | 'recovery',
  ): Promise<boolean> {
    try {
      await this.getQueue().add(
        TELEGRAM_INBOUND_JOB_NAME,
        { inboxRecordId },
        queueOptions(inboxRecordId),
      );
      this.logger.log({ inboxRecordId, message: 'inbox_recovery_enqueued', projectId, source });
      return true;
    } catch {
      this.logger.warn({
        inboxRecordId,
        message: 'recovery_enqueue_failed',
        projectId,
        source,
      });
      return false;
    }
  }

  private getQueue(): TelegramInboundRecoveryQueue {
    if (!this.queue) {
      this.queue = new Queue(TELEGRAM_INBOUND_QUEUE_NAME, {
        connection: redisConnectionFromUrl(this.config.get('REDIS_URL', { infer: true })),
      });
    }
    return this.queue;
  }
}
