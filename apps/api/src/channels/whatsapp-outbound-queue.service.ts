import { Inject, Injectable, Logger, Optional, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WHATSAPP_OUTBOUND_JOB_NAME,
  WHATSAPP_OUTBOUND_QUEUE_NAME,
  type WhatsAppOutboundJob,
  whatsappOutboundJobIdFor,
} from '@omnicus/channel-whatsapp';
import type { ApiEnvironment } from '@omnicus/config/server';
import { Queue } from 'bullmq';

import { redisConnectionFromUrl } from '../telegram-webhook/telegram-redis-connection';

export const WHATSAPP_OUTBOUND_QUEUE = Symbol('WHATSAPP_OUTBOUND_QUEUE');

export interface WhatsAppOutboundQueueProducer {
  add(
    name: string,
    data: WhatsAppOutboundJob,
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
export class WhatsAppOutboundQueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(WhatsAppOutboundQueueService.name);
  private producer: WhatsAppOutboundQueueProducer | undefined;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<ApiEnvironment, true>,
    @Optional() @Inject(WHATSAPP_OUTBOUND_QUEUE) producer?: WhatsAppOutboundQueueProducer,
  ) {
    this.producer = producer;
  }

  async enqueue(outboxRecordId: string): Promise<void> {
    await this.getProducer().add(
      WHATSAPP_OUTBOUND_JOB_NAME,
      { outboxRecordId },
      {
        attempts: 8,
        backoff: { delay: 1_000, type: 'exponential' },
        jobId: whatsappOutboundJobIdFor(outboxRecordId),
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.producer?.close();
    } catch {
      this.logger.warn({ message: 'WhatsApp outbound queue shutdown failed' });
    }
  }

  private getProducer(): WhatsAppOutboundQueueProducer {
    if (!this.producer) {
      this.producer = new Queue(WHATSAPP_OUTBOUND_QUEUE_NAME, {
        connection: {
          ...redisConnectionFromUrl(this.config.get('REDIS_URL', { infer: true })),
        },
      });
    }
    return this.producer;
  }
}
