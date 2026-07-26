import { Inject, Injectable, Logger, Optional, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@omnicus/config/server';
import {
  TELEGRAM_OUTBOUND_JOB_NAME,
  TELEGRAM_OUTBOUND_QUEUE_NAME,
  telegramOutboundJobIdFor,
  type TelegramOutboundJob,
} from '@omnicus/channel-telegram';
import { Queue } from 'bullmq';

import { redisConnectionFromUrl } from '../telegram-webhook/telegram-redis-connection';

export const TELEGRAM_OUTBOUND_QUEUE = Symbol('TELEGRAM_OUTBOUND_QUEUE');
export interface TelegramOutboundQueueProducer {
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
}

@Injectable()
export class TelegramOutboundQueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(TelegramOutboundQueueService.name);
  private producer: TelegramOutboundQueueProducer | undefined;
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<ApiEnvironment, true>,
    @Optional() @Inject(TELEGRAM_OUTBOUND_QUEUE) producer?: TelegramOutboundQueueProducer,
  ) {
    this.producer = producer;
  }
  async enqueue(outboxRecordId: string): Promise<void> {
    await this.producerFor().add(
      TELEGRAM_OUTBOUND_JOB_NAME,
      { outboxRecordId },
      {
        attempts: 8,
        backoff: { delay: 1_000, type: 'exponential' },
        jobId: telegramOutboundJobIdFor(outboxRecordId),
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
  async onApplicationShutdown(): Promise<void> {
    try {
      await this.producer?.close();
    } catch {
      this.logger.warn({ message: 'Telegram outbound queue shutdown failed' });
    }
  }
  private producerFor(): TelegramOutboundQueueProducer {
    if (!this.producer)
      this.producer = new Queue(TELEGRAM_OUTBOUND_QUEUE_NAME, {
        connection: redisConnectionFromUrl(this.config.get('REDIS_URL', { infer: true })),
      });
    return this.producer;
  }
}
