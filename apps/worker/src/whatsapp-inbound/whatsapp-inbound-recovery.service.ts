import {
  Inject,
  Injectable,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WHATSAPP_INBOUND_JOB_NAME,
  WHATSAPP_INBOUND_QUEUE_NAME,
  whatsappInboundJobIdFor,
  type WhatsAppInboundJob,
} from '@omnicus/channel-whatsapp';
import type { WorkerEnvironment } from '@omnicus/config/server';
import { Queue } from 'bullmq';

import { DatabaseService } from '../database/database.service';
import { redisConnectionFromUrl } from '../queue/redis-connection';

export const WHATSAPP_INBOUND_RECOVERY_QUEUE = Symbol('WHATSAPP_INBOUND_RECOVERY_QUEUE');

export interface WhatsAppInboundRecoveryQueue {
  add(
    name: string,
    data: WhatsAppInboundJob,
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
export class WhatsAppInboundRecoveryService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private queue: WhatsAppInboundRecoveryQueue | undefined;
  private scanning = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<WorkerEnvironment, true>,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Optional()
    @Inject(WHATSAPP_INBOUND_RECOVERY_QUEUE)
    queue?: WhatsAppInboundRecoveryQueue,
  ) {
    this.queue = queue;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queueFor().waitUntilReady?.();
    this.timer = setInterval(
      () => void this.scanOnce(),
      this.config.get('WHATSAPP_INBOUND_RECOVERY_INTERVAL_MS', { infer: true }),
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
      const leaseExpiry = new Date(
        now.getTime() - this.config.get('WHATSAPP_INBOUND_LEASE_MS', { infer: true }),
      );
      const records = await this.database.client.inboxRecord.findMany({
        orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, lockedAt: true, projectId: true, status: true },
        take: this.config.get('WHATSAPP_INBOUND_RECOVERY_BATCH_SIZE', { infer: true }),
        where: {
          connection: { type: 'WHATSAPP' },
          OR: [
            { nextAttemptAt: { lte: now }, status: 'PENDING' },
            { nextAttemptAt: { lte: now }, status: 'RETRY' },
            { lockedAt: { lt: leaseExpiry }, status: 'PROCESSING' },
          ],
        },
      });
      for (const record of records) {
        let enqueue = record.status !== 'PROCESSING';
        if (record.status === 'PROCESSING') {
          const recovered = await this.database.client.inboxRecord.updateMany({
            data: {
              lastError: 'whatsapp_inbound_stale_lease_recovered',
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
          enqueue = recovered.count === 1;
        }
        if (!enqueue) continue;
        try {
          await this.queueFor().add(
            WHATSAPP_INBOUND_JOB_NAME,
            { inboxRecordId: record.id },
            {
              attempts: 8,
              backoff: { delay: 1_000, type: 'exponential' },
              jobId: whatsappInboundJobIdFor(record.id),
              removeOnComplete: true,
              removeOnFail: true,
            },
          );
        } catch {
          // PostgreSQL intent remains recoverable.
        }
      }
    } finally {
      this.scanning = false;
    }
  }

  private queueFor(): WhatsAppInboundRecoveryQueue {
    if (!this.queue)
      this.queue = new Queue(WHATSAPP_INBOUND_QUEUE_NAME, {
        connection: redisConnectionFromUrl(this.config.get('REDIS_URL', { infer: true })),
      });
    return this.queue;
  }
}
