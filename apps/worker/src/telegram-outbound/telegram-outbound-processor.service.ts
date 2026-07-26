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
import { ChannelSecretsService, type EncryptedSecretEnvelope } from '@omnicus/channel-secrets';
import {
  TelegramAdapter,
  TelegramApiError,
  TelegramHttpTransport,
  TELEGRAM_OUTBOUND_JOB_NAME,
  TELEGRAM_OUTBOUND_QUEUE_NAME,
  type TelegramOutboundJob,
} from '@omnicus/channel-telegram';
import type { WorkerEnvironment } from '@omnicus/config/server';
import { Worker, type Job } from 'bullmq';
import { DatabaseService } from '../database/database.service';
import { redisConnectionFromUrl } from '../queue/redis-connection';

export const TELEGRAM_OUTBOUND_PROCESSOR_CLIENT = Symbol('TELEGRAM_OUTBOUND_PROCESSOR_CLIENT');
export interface TelegramOutboundProcessorClient {
  close(force?: boolean): Promise<void>;
  waitUntilReady(): Promise<unknown>;
  on(event: 'error', listener: (error: Error) => void): unknown;
}
type Claimed = {
  id: string;
  projectId: string;
  connectionId: string;
  attempts: number;
  maxAttempts: number;
  lease: string;
  payload: { messageId: string; channelIdentityId: string };
};

@Injectable()
export class TelegramOutboundProcessorService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(TelegramOutboundProcessorService.name);
  private client: TelegramOutboundProcessorClient | undefined;
  private readonly workerId = `telegram-outbound-${process.pid}-${randomUUID()}`;
  private readonly secrets: ChannelSecretsService;
  private readonly adapter = new TelegramAdapter(new TelegramHttpTransport());
  constructor(
    @Inject(ConfigService) config: ConfigService<WorkerEnvironment, true>,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Optional()
    @Inject(TELEGRAM_OUTBOUND_PROCESSOR_CLIENT)
    client?: TelegramOutboundProcessorClient,
  ) {
    this.config = config;
    this.client = client;
    this.secrets = new ChannelSecretsService(config.get('CHANNEL_SECRETS_KEY', { infer: true }));
  }
  private readonly config: ConfigService<WorkerEnvironment, true>;
  async onApplicationBootstrap(): Promise<void> {
    if (!this.client)
      this.client = new Worker(
        TELEGRAM_OUTBOUND_QUEUE_NAME,
        async (job: Job<TelegramOutboundJob>) => {
          if (job.name !== TELEGRAM_OUTBOUND_JOB_NAME)
            throw new Error('Unsupported Telegram outbound job');
          await this.process(job.data);
        },
        {
          connection: {
            ...redisConnectionFromUrl(this.config.get('REDIS_URL', { infer: true })),
            maxRetriesPerRequest: null,
          },
          concurrency: 4,
        },
      );
    this.client.on('error', () => this.logger.error({ message: 'Telegram outbound worker error' }));
    await this.client.waitUntilReady();
  }
  async onApplicationShutdown(): Promise<void> {
    await this.client?.close(true);
  }
  async process(job: TelegramOutboundJob): Promise<void> {
    const claimed = await this.claim(job.outboxRecordId);
    if (!claimed) return;
    try {
      const [message, connection, identity] = await Promise.all([
        this.database.client.message.findUnique({
          where: { projectId_id: { projectId: claimed.projectId, id: claimed.payload.messageId } },
        }),
        this.database.client.channelConnection.findUnique({
          where: { projectId_id: { projectId: claimed.projectId, id: claimed.connectionId } },
        }),
        this.database.client.channelIdentity.findUnique({
          where: { id: claimed.payload.channelIdentityId },
        }),
      ]);
      if (
        !message ||
        !connection ||
        !identity ||
        identity.projectId !== claimed.projectId ||
        identity.connectionId !== claimed.connectionId
      )
        return await this.finish(claimed, 'FAILED', 'telegram_outbound_invalid_relation');
      if (message.status === 'SENT') return await this.finish(claimed, 'SUCCEEDED');
      const token = this.secrets.decryptSecret({
        projectId: connection.projectId,
        channelConnectionId: connection.id,
        channelType: 'telegram',
        field: 'botToken',
        envelope: connection.credentialsEncrypted as unknown as EncryptedSecretEnvelope,
      });
      const metadata = message.metadata as {
        disableNotification?: boolean;
        replyToMessageId?: string;
      } | null;
      const content = message.content as { text?: string };
      const sent = await this.adapter.sendMessage(token, {
        chatId: identity.externalUserId,
        text: content.text ?? '',
        ...(metadata?.disableNotification ? { disableNotification: true } : {}),
        ...(metadata?.replyToMessageId ? { replyToMessageId: metadata.replyToMessageId } : {}),
      });
      await this.database.client.$transaction(async (tx) => {
        const done = await tx.outboxRecord.updateMany({
          where: {
            id: claimed.id,
            projectId: claimed.projectId,
            lockedBy: claimed.lease,
            status: 'PROCESSING',
          },
          data: {
            status: 'SUCCEEDED',
            completedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            lastError: null,
          },
        });
        if (done.count !== 1) return;
        await tx.message.update({
          where: { projectId_id: { projectId: claimed.projectId, id: message.id } },
          data: { status: 'SENT', sentAt: new Date(), externalMessageId: sent.messageId },
        });
      });
    } catch (error) {
      await this.fail(claimed, error);
      if (this.retryable(error)) throw error;
    }
  }
  private async claim(id: string): Promise<Claimed | undefined> {
    const now = new Date();
    const lease = `${this.workerId}-${randomUUID()}`;
    const row = await this.database.client.outboxRecord.findUnique({ where: { id } });
    if (
      !row ||
      row.kind !== 'TELEGRAM' ||
      !row.connectionId ||
      !['PENDING', 'RETRY', 'PROCESSING'].includes(row.status)
    )
      return undefined;
    const expiry = new Date(
      now.getTime() - this.config.get('TELEGRAM_OUTBOUND_LEASE_MS', { infer: true }),
    );
    const updated = await this.database.client.outboxRecord.updateMany({
      where: {
        id,
        status: { in: ['PENDING', 'RETRY', 'PROCESSING'] },
        OR: [
          { status: { in: ['PENDING', 'RETRY'] }, nextAttemptAt: { lte: now } },
          { status: 'PROCESSING', lockedAt: { lt: expiry } },
        ],
      },
      data: {
        status: 'PROCESSING',
        attempts: { increment: 1 },
        lockedAt: now,
        lockedBy: lease,
        lastError: null,
      },
    });
    if (!updated.count) return undefined;
    return {
      id: row.id,
      projectId: row.projectId,
      connectionId: row.connectionId,
      attempts: row.attempts + 1,
      maxAttempts: row.maxAttempts,
      lease,
      payload: row.payload as { messageId: string; channelIdentityId: string },
    };
  }
  private retryable(error: unknown): boolean {
    return error instanceof TelegramApiError
      ? error.errorCode === 429 || (error.errorCode !== undefined && error.errorCode >= 500)
      : !(error instanceof Error && error.name === 'AbortError');
  }
  private async finish(
    claimed: Claimed,
    status: 'FAILED' | 'SUCCEEDED',
    error?: string,
  ): Promise<void> {
    await this.database.client.outboxRecord.updateMany({
      where: {
        id: claimed.id,
        projectId: claimed.projectId,
        lockedBy: claimed.lease,
        status: 'PROCESSING',
      },
      data: {
        status,
        completedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        ...(error ? { lastError: error } : { lastError: null }),
      },
    });
  }
  private async fail(claimed: Claimed, error: unknown): Promise<void> {
    const api = error instanceof TelegramApiError ? error : undefined;
    const unknown = error instanceof Error && error.name === 'AbortError';
    const retry = this.retryable(error) && !unknown && claimed.attempts < claimed.maxAttempts;
    const delay =
      api?.errorCode === 429 && api.retryAfterSeconds
        ? api.retryAfterSeconds * 1_000
        : Math.min(300_000, 1_000 * 2 ** Math.min(claimed.attempts, 8));
    const code = unknown
      ? 'telegram_outbound_unknown'
      : api?.errorCode === 401
        ? 'telegram_outbound_invalid_token'
        : api?.errorCode === 403 || api?.errorCode === 400
          ? 'telegram_outbound_recipient_unavailable'
          : retry
            ? 'telegram_outbound_retryable'
            : 'telegram_outbound_failed';
    await this.database.client.$transaction(async (tx) => {
      await tx.outboxRecord.updateMany({
        where: {
          id: claimed.id,
          projectId: claimed.projectId,
          lockedBy: claimed.lease,
          status: 'PROCESSING',
        },
        data: {
          status: unknown ? 'UNKNOWN' : retry ? 'RETRY' : 'FAILED',
          lockedAt: null,
          lockedBy: null,
          lastError: code,
          ...(retry
            ? { nextAttemptAt: new Date(Date.now() + delay) }
            : { completedAt: new Date(), nextAttemptAt: null }),
        },
      });
      await tx.message.updateMany({
        where: { id: claimed.payload.messageId, projectId: claimed.projectId },
        data: {
          status: unknown ? 'UNKNOWN' : retry ? 'QUEUED' : 'FAILED',
          ...(retry ? {} : { failedAt: new Date() }),
        },
      });
      if (api?.errorCode === 401)
        await tx.channelConnection.updateMany({
          where: { id: claimed.connectionId, projectId: claimed.projectId },
          data: { status: 'ERROR', lastErrorAt: new Date() },
        });
      if (api?.errorCode === 403 || api?.errorCode === 400)
        await tx.channelIdentity.updateMany({
          where: { id: claimed.payload.channelIdentityId, projectId: claimed.projectId },
          data: { status: 'BLOCKED' },
        });
    });
  }
}
