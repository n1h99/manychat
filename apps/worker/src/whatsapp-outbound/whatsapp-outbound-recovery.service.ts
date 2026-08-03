import {
  Inject,
  Injectable,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WHATSAPP_OUTBOUND_JOB_NAME,
  WHATSAPP_OUTBOUND_QUEUE_NAME,
  whatsappOutboundJobIdFor,
  type WhatsAppOutboundJob,
} from '@omnicus/channel-whatsapp';
import type { WorkerEnvironment } from '@omnicus/config/server';
import { Queue } from 'bullmq';

import { DatabaseService } from '../database/database.service';
import { redisConnectionFromUrl } from '../queue/redis-connection';

export const WHATSAPP_OUTBOUND_RECOVERY_QUEUE = Symbol('WHATSAPP_OUTBOUND_RECOVERY_QUEUE');

export interface WhatsAppOutboundRecoveryQueue {
  add(
    name: string,
    data: WhatsAppOutboundJob,
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
export class WhatsAppOutboundRecoveryService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private queue: WhatsAppOutboundRecoveryQueue | undefined;
  private scanning = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<WorkerEnvironment, true>,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Optional()
    @Inject(WHATSAPP_OUTBOUND_RECOVERY_QUEUE)
    queue?: WhatsAppOutboundRecoveryQueue,
  ) {
    this.queue = queue;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queueFor().waitUntilReady?.();
    this.timer = setInterval(
      () => void this.scanOnce(),
      this.config.get('WHATSAPP_OUTBOUND_RECOVERY_INTERVAL_MS', { infer: true }),
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
        now.getTime() - this.config.get('WHATSAPP_OUTBOUND_LEASE_MS', { infer: true }),
      );
      const rows = await this.database.client.outboxRecord.findMany({
        select: { id: true, projectId: true, status: true },
        take: this.config.get('WHATSAPP_OUTBOUND_RECOVERY_BATCH_SIZE', { infer: true }),
        where: {
          kind: 'WHATSAPP',
          OR: [
            {
              status: 'PENDING',
              OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
            },
            { nextAttemptAt: { lte: now }, status: 'RETRY' },
            { lockedAt: { lt: leaseExpiry }, status: 'PROCESSING' },
          ],
        },
      });
      for (const row of rows) {
        let enqueue = row.status !== 'PROCESSING';
        if (row.status === 'PROCESSING') {
          const recovered = await this.database.client.outboxRecord.updateMany({
            data: {
              lastError: 'whatsapp_outbound_stale_lease_recovered',
              lockedAt: null,
              lockedBy: null,
              nextAttemptAt: now,
              status: 'RETRY',
            },
            where: {
              id: row.id,
              lockedAt: { lt: leaseExpiry },
              projectId: row.projectId,
              status: 'PROCESSING',
            },
          });
          enqueue = recovered.count === 1;
        }
        if (!enqueue) continue;
        try {
          await this.queueFor().add(
            WHATSAPP_OUTBOUND_JOB_NAME,
            { outboxRecordId: row.id },
            {
              attempts: 8,
              backoff: { delay: 1_000, type: 'exponential' },
              jobId: whatsappOutboundJobIdFor(row.id),
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

  private queueFor(): WhatsAppOutboundRecoveryQueue {
    if (!this.queue)
      this.queue = new Queue(WHATSAPP_OUTBOUND_QUEUE_NAME, {
        connection: redisConnectionFromUrl(this.config.get('REDIS_URL', { infer: true })),
      });
    return this.queue;
  }
}
