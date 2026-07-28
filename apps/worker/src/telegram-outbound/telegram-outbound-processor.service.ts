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
import { S3MediaStorage } from '@omnicus/media-core';
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

class TelegramOutboundPermanentError extends Error {
  constructor(readonly code: string) {
    super('Telegram outbound request cannot be retried');
    this.name = 'TelegramOutboundPermanentError';
  }
}

@Injectable()
export class TelegramOutboundProcessorService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(TelegramOutboundProcessorService.name);
  private client: TelegramOutboundProcessorClient | undefined;
  private readonly workerId = `telegram-outbound-${process.pid}-${randomUUID()}`;
  private readonly secrets: ChannelSecretsService;
  private readonly storage: S3MediaStorage | undefined;
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
    if (config.get('MEDIA_STORAGE_ENABLED', { infer: true }))
      this.storage = new S3MediaStorage({
        accessKeyId: config.get('MEDIA_BUCKET_ACCESS_KEY_ID', { infer: true })!,
        bucket: config.get('MEDIA_BUCKET', { infer: true })!,
        endpoint: config.get('MEDIA_BUCKET_ENDPOINT', { infer: true })!,
        forcePathStyle: config.get('MEDIA_BUCKET_FORCE_PATH_STYLE', { infer: true }),
        region: config.get('MEDIA_BUCKET_REGION', { infer: true }),
        secretAccessKey: config.get('MEDIA_BUCKET_SECRET_ACCESS_KEY', { infer: true })!,
      });
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
      const [message, connection, identity, recipient] = await Promise.all([
        this.database.client.message.findUnique({
          include: { mediaAsset: true },
          where: { projectId_id: { projectId: claimed.projectId, id: claimed.payload.messageId } },
        }),
        this.database.client.channelConnection.findUnique({
          where: { projectId_id: { projectId: claimed.projectId, id: claimed.connectionId } },
        }),
        this.database.client.channelIdentity.findUnique({
          where: { id: claimed.payload.channelIdentityId },
        }),
        this.database.client.broadcastRecipient.findFirst({
          where: { outboxRecordId: claimed.id, projectId: claimed.projectId },
          include: { broadcast: { select: { status: true } } },
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
      if (recipient?.broadcast.status === 'CANCELLED')
        return await this.cancelBroadcastRecipient(claimed, recipient.id);
      if (recipient?.broadcast.status === 'PAUSED')
        return await this.deferBroadcastRecipient(claimed);
      if (message.status === 'SENT') return await this.finish(claimed, 'SUCCEEDED');
      if (recipient)
        await this.database.client.broadcastRecipient.updateMany({
          where: { id: recipient.id, projectId: claimed.projectId, status: 'QUEUED' },
          data: { status: 'PROCESSING' },
        });
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
      const content = message.content as { caption?: string; text?: string };
      const sendOptions = {
        chatId: identity.externalUserId,
        ...(metadata?.disableNotification ? { disableNotification: true } : {}),
        ...(metadata?.replyToMessageId ? { replyToMessageId: metadata.replyToMessageId } : {}),
      };
      const sent =
        (message.type === 'PHOTO' || message.type === 'DOCUMENT') && message.mediaAsset
          ? await this.adapter.sendMedia(token, {
              ...sendOptions,
              ...(content.caption ? { caption: content.caption } : {}),
              kind: message.type,
              media: await this.mediaReference(message.mediaAsset, claimed.connectionId),
            })
          : await this.adapter.sendMessage(token, {
              ...sendOptions,
              text: content.text ?? '',
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
        if (recipient) {
          await tx.broadcastRecipient.updateMany({
            where: { id: recipient.id, projectId: claimed.projectId, status: 'PROCESSING' },
            data: { status: 'SENT', completedAt: new Date(), lastError: null },
          });
          await this.completeBroadcastIfTerminal(tx, claimed.projectId, recipient.broadcastId);
        }
      });
    } catch (error) {
      await this.fail(claimed, error);
      if (this.retryable(error)) throw error;
    }
  }
  private async mediaReference(
    asset: {
      bucketKey: string | null;
      connectionId: string | null;
      providerMediaId: string | null;
      status: string;
    },
    connectionId: string,
  ): Promise<string> {
    if (
      asset.providerMediaId &&
      asset.connectionId === connectionId &&
      asset.status !== 'REJECTED' &&
      asset.status !== 'UNAVAILABLE'
    )
      return asset.providerMediaId;
    if (asset.status !== 'AVAILABLE' || !asset.bucketKey || !this.storage)
      throw new TelegramOutboundPermanentError('telegram_outbound_media_unavailable');
    return this.storage.signedDownloadUrl(
      asset.bucketKey,
      this.config.get('MEDIA_SIGNED_URL_TTL_SECONDS', { infer: true }),
    );
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
          {
            status: { in: ['PENDING', 'RETRY'] },
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
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
    if (error instanceof TelegramOutboundPermanentError) return false;
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
  private async deferBroadcastRecipient(claimed: Claimed): Promise<void> {
    await this.database.client.$transaction(async (tx) => {
      await tx.outboxRecord.updateMany({
        where: {
          id: claimed.id,
          projectId: claimed.projectId,
          lockedBy: claimed.lease,
          status: 'PROCESSING',
        },
        data: {
          status: 'RETRY',
          lockedAt: null,
          lockedBy: null,
          lastError: 'broadcast_paused',
          nextAttemptAt: new Date(Date.now() + 30_000),
        },
      });
      await tx.broadcastRecipient.updateMany({
        where: { projectId: claimed.projectId, outboxRecordId: claimed.id, status: 'QUEUED' },
        data: { lastError: 'broadcast_paused' },
      });
    });
  }
  private async cancelBroadcastRecipient(claimed: Claimed, recipientId: string): Promise<void> {
    await this.database.client.$transaction(async (tx) => {
      await tx.outboxRecord.updateMany({
        where: {
          id: claimed.id,
          projectId: claimed.projectId,
          lockedBy: claimed.lease,
          status: 'PROCESSING',
        },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: 'broadcast_cancelled',
        },
      });
      await tx.message.updateMany({
        where: { id: claimed.payload.messageId, projectId: claimed.projectId, status: 'QUEUED' },
        data: { status: 'FAILED', failedAt: new Date() },
      });
      await tx.broadcastRecipient.updateMany({
        where: {
          id: recipientId,
          projectId: claimed.projectId,
          status: { in: ['QUEUED', 'PROCESSING'] },
        },
        data: { status: 'CANCELLED', completedAt: new Date(), lastError: 'broadcast_cancelled' },
      });
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
      : error instanceof TelegramOutboundPermanentError
        ? error.code
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
      const recipient = await tx.broadcastRecipient.findFirst({
        where: { projectId: claimed.projectId, outboxRecordId: claimed.id },
      });
      if (recipient) {
        await tx.broadcastRecipient.updateMany({
          where: {
            id: recipient.id,
            projectId: claimed.projectId,
            status: { in: ['QUEUED', 'PROCESSING'] },
          },
          data: {
            status: unknown ? 'UNKNOWN' : retry ? 'QUEUED' : 'FAILED',
            ...(retry ? { lastError: code } : { completedAt: new Date(), lastError: code }),
          },
        });
        if (!retry)
          await this.completeBroadcastIfTerminal(tx, claimed.projectId, recipient.broadcastId);
      }
    });
  }
  private async completeBroadcastIfTerminal(
    transaction: {
      broadcast: { updateMany(args: unknown): Promise<unknown> };
      broadcastRecipient: { count(args: unknown): Promise<number> };
    },
    projectId: string,
    broadcastId: string,
  ): Promise<void> {
    const nonTerminal = await transaction.broadcastRecipient.count({
      where: { projectId, broadcastId, status: { in: ['PENDING', 'QUEUED', 'PROCESSING'] } },
    });
    if (nonTerminal === 0)
      await transaction.broadcast.updateMany({
        where: { id: broadcastId, projectId, status: 'RUNNING' },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
  }
}
