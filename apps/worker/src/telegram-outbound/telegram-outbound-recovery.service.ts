import {
  Inject,
  Injectable,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TELEGRAM_OUTBOUND_JOB_NAME,
  TELEGRAM_OUTBOUND_QUEUE_NAME,
  telegramOutboundJobIdFor,
  type TelegramOutboundJob,
} from '@omnicus/channel-telegram';
import type { WorkerEnvironment } from '@omnicus/config/server';
import { Queue } from 'bullmq';
import { DatabaseService } from '../database/database.service';
import { redisConnectionFromUrl } from '../queue/redis-connection';
export const TELEGRAM_OUTBOUND_RECOVERY_QUEUE = Symbol('TELEGRAM_OUTBOUND_RECOVERY_QUEUE');
interface QueueClient {
  add(
    name: string,
    data: TelegramOutboundJob,
    options: {
      attempts: number;
      backoff: { delay: number; type: 'exponential' };
      jobId: string;
      removeOnComplete: boolean;
      removeOnFail: boolean;
    },
  ): Promise<unknown>;
  close(): Promise<void>;
  waitUntilReady?(): Promise<unknown>;
}
@Injectable()
export class TelegramOutboundRecoveryService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private queue: QueueClient | undefined;
  private timer: NodeJS.Timeout | undefined;
  private scanning = false;
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<WorkerEnvironment, true>,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Optional() @Inject(TELEGRAM_OUTBOUND_RECOVERY_QUEUE) queue?: QueueClient,
  ) {
    this.queue = queue;
  }
  async onApplicationBootstrap(): Promise<void> {
    await this.queueFor().waitUntilReady?.();
    this.timer = setInterval(
      () => void this.scanOnce(),
      this.config.get('TELEGRAM_OUTBOUND_RECOVERY_INTERVAL_MS', { infer: true }),
    );
    this.timer.unref();
  }
  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.queue?.close();
  }
  async scanOnce(now = new Date()): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const expiry = new Date(
        now.getTime() - this.config.get('TELEGRAM_OUTBOUND_LEASE_MS', { infer: true }),
      );
      const rows = await this.database.client.outboxRecord.findMany({
        where: {
          kind: 'TELEGRAM',
          OR: [
            { status: 'PENDING', nextAttemptAt: { lte: now } },
            { status: 'RETRY', nextAttemptAt: { lte: now } },
            { status: 'PROCESSING', lockedAt: { lt: expiry } },
          ],
        },
        select: { id: true, projectId: true, status: true },
        take: this.config.get('TELEGRAM_OUTBOUND_RECOVERY_BATCH_SIZE', { infer: true }),
      });
      for (const row of rows) {
        if (row.status === 'PROCESSING')
          await this.database.client.outboxRecord.updateMany({
            where: {
              id: row.id,
              projectId: row.projectId,
              status: 'PROCESSING',
              lockedAt: { lt: expiry },
            },
            data: {
              status: 'RETRY',
              lockedAt: null,
              lockedBy: null,
              nextAttemptAt: now,
              lastError: 'telegram_outbound_stale_lease_recovered',
            },
          });
        try {
          await this.queueFor().add(
            TELEGRAM_OUTBOUND_JOB_NAME,
            { outboxRecordId: row.id },
            {
              attempts: 8,
              backoff: { delay: 1000, type: 'exponential' },
              jobId: telegramOutboundJobIdFor(row.id),
              removeOnComplete: true,
              removeOnFail: true,
            },
          );
        } catch {
          /* PostgreSQL record remains recoverable */
        }
      }
    } finally {
      this.scanning = false;
    }
  }
  private queueFor(): QueueClient {
    if (!this.queue)
      this.queue = new Queue(TELEGRAM_OUTBOUND_QUEUE_NAME, {
        connection: redisConnectionFromUrl(this.config.get('REDIS_URL', { infer: true })),
      });
    return this.queue;
  }
}
