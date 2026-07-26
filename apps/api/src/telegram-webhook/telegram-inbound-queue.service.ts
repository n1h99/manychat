import { Inject, Injectable, Logger, Optional, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@omnicus/config/server';
import {
  TELEGRAM_INBOUND_JOB_NAME,
  TELEGRAM_INBOUND_QUEUE_NAME,
  telegramInboundJobIdFor,
  type TelegramInboundJob,
} from '@omnicus/channel-telegram';
import { Queue } from 'bullmq';

import { redisConnectionFromUrl } from './telegram-redis-connection';

export const TELEGRAM_INBOUND_QUEUE = Symbol('TELEGRAM_INBOUND_QUEUE');

export {
  TELEGRAM_INBOUND_JOB_NAME,
  TELEGRAM_INBOUND_QUEUE_NAME,
  telegramInboundJobIdFor,
  type TelegramInboundJob,
};

export interface TelegramInboundQueueProducer {
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
}

@Injectable()
export class TelegramInboundQueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(TelegramInboundQueueService.name);
  private readonly config: ConfigService<ApiEnvironment, true>;
  private producer: TelegramInboundQueueProducer | undefined;

  constructor(
    @Inject(ConfigService) config: ConfigService<ApiEnvironment, true>,
    @Optional() @Inject(TELEGRAM_INBOUND_QUEUE) producer?: TelegramInboundQueueProducer,
  ) {
    this.config = config;
    this.producer = producer;
  }

  async enqueue(inboxRecordId: string): Promise<void> {
    await this.getProducer().add(
      TELEGRAM_INBOUND_JOB_NAME,
      { inboxRecordId },
      {
        attempts: 8,
        backoff: { delay: 1_000, type: 'exponential' },
        jobId: telegramInboundJobIdFor(inboxRecordId),
        // Terminal jobs are removed so a recovery/manual retry can reuse the
        // stable inbox job ID without leaving an orphaned BullMQ job behind.
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.producer?.close();
    } catch {
      this.logger.warn({ message: 'Telegram inbound queue shutdown failed' });
    }
  }

  private getProducer(): TelegramInboundQueueProducer {
    if (!this.producer) {
      this.producer = new Queue(TELEGRAM_INBOUND_QUEUE_NAME, {
        connection: {
          ...redisConnectionFromUrl(this.config.get('REDIS_URL', { infer: true })),
        },
      });
    }
    return this.producer;
  }
}
