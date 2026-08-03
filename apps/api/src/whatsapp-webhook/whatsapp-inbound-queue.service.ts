import { Inject, Injectable, Logger, Optional, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WHATSAPP_INBOUND_JOB_NAME,
  WHATSAPP_INBOUND_QUEUE_NAME,
  type WhatsAppInboundJob,
  whatsappInboundJobIdFor,
} from '@omnicus/channel-whatsapp';
import type { ApiEnvironment } from '@omnicus/config/server';
import { Queue } from 'bullmq';

import { redisConnectionFromUrl } from '../telegram-webhook/telegram-redis-connection';

export const WHATSAPP_INBOUND_QUEUE = Symbol('WHATSAPP_INBOUND_QUEUE');

export interface WhatsAppInboundQueueProducer {
  add(
    name: string,
    data: WhatsAppInboundJob,
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
export class WhatsAppInboundQueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(WhatsAppInboundQueueService.name);
  private producer: WhatsAppInboundQueueProducer | undefined;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<ApiEnvironment, true>,
    @Optional() @Inject(WHATSAPP_INBOUND_QUEUE) producer?: WhatsAppInboundQueueProducer,
  ) {
    this.producer = producer;
  }

  async enqueue(inboxRecordId: string): Promise<void> {
    await this.getProducer().add(
      WHATSAPP_INBOUND_JOB_NAME,
      { inboxRecordId },
      {
        attempts: 8,
        backoff: { delay: 1_000, type: 'exponential' },
        jobId: whatsappInboundJobIdFor(inboxRecordId),
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.producer?.close();
    } catch {
      this.logger.warn({ message: 'WhatsApp inbound queue shutdown failed' });
    }
  }

  private getProducer(): WhatsAppInboundQueueProducer {
    if (!this.producer) {
      this.producer = new Queue(WHATSAPP_INBOUND_QUEUE_NAME, {
        connection: {
          ...redisConnectionFromUrl(this.config.get('REDIS_URL', { infer: true })),
        },
      });
    }
    return this.producer;
  }
}
