import { createHash, randomUUID } from 'node:crypto';

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WorkerEnvironment } from '@omnicus/config/server';
import { ChannelSecretsService, type EncryptedSecretEnvelope } from '@omnicus/channel-secrets';
import { TelegramAdapter, TelegramHttpTransport } from '@omnicus/channel-telegram';
import {
  CrmClientError,
  type CrmClient,
  type CrmIdentityInput,
  type CrmInteractiveInput,
  type CrmMediaInput,
} from '@omnicus/crm-core';
import type { Prisma } from '@omnicus/database';
import { prepareMediaForTelegram, S3MediaStorage, type MediaKind } from '@omnicus/media-core';

import { DatabaseService } from '../database/database.service';
import { CRM_CLIENT } from './crm.tokens';

@Injectable()
export class CrmOutboxService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CrmOutboxService.name);
  private readonly workerId = `crm-outbox-${process.pid}-${randomUUID()}`;
  private readonly maximumMediaBytes: number;
  private readonly mediaRetentionDays: number;
  private readonly signedUrlTtlSeconds: number;
  private readonly secrets: ChannelSecretsService;
  private readonly storage: S3MediaStorage | undefined;
  private readonly telegram = new TelegramAdapter(new TelegramHttpTransport());
  private timer: NodeJS.Timeout | undefined;
  private scanning = false;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<WorkerEnvironment, true>,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CRM_CLIENT) private readonly client: CrmClient,
  ) {
    this.maximumMediaBytes = config.get('MEDIA_MAX_UPLOAD_BYTES', { infer: true });
    this.mediaRetentionDays = config.get('MEDIA_RETENTION_DAYS', { infer: true });
    this.signedUrlTtlSeconds = config.get('MEDIA_SIGNED_URL_TTL_SECONDS', { infer: true });
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

  onApplicationBootstrap(): void {
    if (!this.config.get('CRM_INTEGRATION_ENABLED', { infer: true })) return;
    this.timer = setInterval(
      () => void this.scanOnce(),
      this.config.get('CRM_OUTBOX_INTERVAL_MS', { infer: true }),
    );
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async scanOnce(now = new Date()): Promise<void> {
    if (!this.config.get('CRM_INTEGRATION_ENABLED', { infer: true }) || this.scanning) return;
    this.scanning = true;
    try {
      const leaseExpiredBefore = new Date(
        now.getTime() - this.config.get('CRM_OUTBOX_LEASE_MS', { infer: true }),
      );
      const rows = await this.database.client.outboxRecord.findMany({
        orderBy: { createdAt: 'asc' },
        take: 25,
        where: {
          kind: 'CRM',
          OR: [
            {
              status: { in: ['PENDING', 'RETRY'] },
              OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
            },
            { lockedAt: { lt: leaseExpiredBefore }, status: 'PROCESSING' },
          ],
        },
      });
      for (const row of rows) await this.process(row.id, now, leaseExpiredBefore);
    } finally {
      this.scanning = false;
    }
  }

  private async process(
    outboxRecordId: string,
    now: Date,
    leaseExpiredBefore: Date,
  ): Promise<void> {
    const leaseToken = `${this.workerId}-${randomUUID()}`;
    const claimed = await this.database.client.outboxRecord.updateMany({
      data: {
        attempts: { increment: 1 },
        lastError: null,
        lockedAt: now,
        lockedBy: leaseToken,
        status: 'PROCESSING',
      },
      where: {
        id: outboxRecordId,
        kind: 'CRM',
        OR: [
          {
            status: { in: ['PENDING', 'RETRY'] },
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          { lockedAt: { lt: leaseExpiredBefore }, status: 'PROCESSING' },
        ],
      },
    });
    if (claimed.count !== 1) return;

    const operation = await this.database.client.crmOperation.findUnique({
      include: {
        contact: {
          include: {
            channelIdentities: {
              orderBy: { createdAt: 'asc' },
              where: { channel: 'TELEGRAM' },
            },
            customFieldValues: {
              include: { definition: { select: { key: true } } },
            },
            tags: { include: { tag: { select: { id: true, name: true } } } },
          },
        },
        normalizedEvent: {
          include: {
            inboxRecord: {
              select: {
                rawWebhookEvent: { select: { correlationId: true } },
              },
            },
            message: {
              include: {
                conversation: { select: { externalChatId: true } },
                mediaAsset: true,
              },
            },
          },
        },
        outbox: { select: { attempts: true, maxAttempts: true } },
        project: { include: { crmConfig: true } },
      },
      where: { outboxRecordId },
    });
    if (!operation?.project.crmConfig?.enabled || !operation.contact) {
      await this.finish(
        outboxRecordId,
        leaseToken,
        'FAILED',
        'crm_configuration_or_contact_missing',
      );
      return;
    }

    const connectionId = operation.normalizedEvent?.connectionId;
    const identityRow =
      operation.contact.channelIdentities.find(
        (identity) => identity.connectionId === connectionId,
      ) ?? operation.contact.channelIdentities[0];
    if (!identityRow) {
      await this.finish(outboxRecordId, leaseToken, 'FAILED', 'crm_channel_identity_missing');
      return;
    }

    const identity: CrmIdentityInput = {
      channel: 'telegram',
      channelIdentityId: identityRow.id,
      connectionId: identityRow.connectionId,
      ...(operation.normalizedEvent?.message?.conversation.externalChatId
        ? { externalChatId: operation.normalizedEvent.message.conversation.externalChatId }
        : {}),
      externalUserId: identityRow.externalUserId,
    };
    const context = {
      correlationId:
        operation.normalizedEvent?.inboxRecord.rawWebhookEvent.correlationId ??
        `crm-operation-${operation.id}`,
      crmProjectId: operation.project.crmConfig.crmProjectId,
      idempotencyKey: outboxRecordId,
      projectId: operation.projectId,
    };
    const interactive = await this.interactive(
      operation.projectId,
      connectionId,
      operation.normalizedEvent?.payload,
    );
    const inboundText =
      this.messageText(operation.normalizedEvent?.message?.content) ??
      interactive?.displayText ??
      interactive?.data;

    try {
      const result =
        operation.type === 'CREATE_OR_UPDATE_LEAD'
          ? await this.client.createOrUpdateLead(context, {
              contactId: operation.contact.id,
              contactStatus: operation.contact.status,
              customFields: this.customFields(operation.contact),
              displayName: operation.contact.displayName,
              ...(operation.contact.email ? { email: operation.contact.email } : {}),
              identity,
              ...(operation.contact.phone ? { phone: operation.contact.phone } : {}),
              tags: operation.contact.tags.map(({ tag }) => tag),
              ...(operation.contact.username ? { username: operation.contact.username } : {}),
            })
          : await this.client.forwardInboundMessage(context, {
              contactId: operation.contact.id,
              identity,
              ...(interactive ? { interactive } : {}),
              ...(await this.media(
                operation.projectId,
                connectionId,
                operation.normalizedEvent?.message?.mediaAsset,
              )),
              ...(operation.normalizedEvent?.message?.id
                ? { messageId: operation.normalizedEvent.message.id }
                : {}),
              normalizedEventId: operation.normalizedEventId ?? operation.id,
              occurredAt:
                operation.normalizedEvent?.message?.createdAt.toISOString() ??
                operation.createdAt.toISOString(),
              senderName: operation.contact.displayName,
              ...(inboundText === undefined ? {} : { text: inboundText }),
            });
      await this.finishSuccess(
        operation,
        outboxRecordId,
        leaseToken,
        result,
        operation.type === 'CREATE_OR_UPDATE_LEAD' && !operation.contact.crmLeadId,
      );
    } catch (error) {
      const failure =
        error instanceof CrmClientError
          ? error
          : new CrmClientError('RETRYABLE_FAILURE', 'crm_unexpected_failure');
      if (failure.outcome === 'UNKNOWN') {
        await this.finish(outboxRecordId, leaseToken, 'UNKNOWN', failure.safeCode);
        return;
      }
      if (
        failure.outcome === 'PERMANENT_FAILURE' ||
        operation.outbox.attempts >= operation.outbox.maxAttempts
      ) {
        await this.finish(
          outboxRecordId,
          leaseToken,
          'FAILED',
          failure.outcome === 'PERMANENT_FAILURE' ? failure.safeCode : 'crm_retry_exhausted',
        );
        return;
      }
      const retryDelay =
        failure.retryAfterMs ??
        Math.min(300_000, 1_000 * 2 ** Math.min(operation.outbox.attempts, 12));
      await this.database.client.outboxRecord.updateMany({
        data: {
          lastError: failure.safeCode,
          lockedAt: null,
          lockedBy: null,
          nextAttemptAt: new Date(Date.now() + retryDelay),
          status: 'RETRY',
        },
        where: { id: outboxRecordId, lockedBy: leaseToken, status: 'PROCESSING' },
      });
      this.logger.warn({
        errorCode: failure.safeCode,
        message: 'crm_retry_scheduled',
        outboxRecordId,
        projectId: operation.projectId,
      });
    }
  }

  private async finishSuccess(
    operation: {
      contactId: string | null;
      id: string;
      projectId: string;
      type: 'CREATE_OR_UPDATE_LEAD' | 'FORWARD_INBOUND_MESSAGE';
    },
    outboxRecordId: string,
    leaseToken: string,
    result: { mode: string; operationId: string; providerReference: string },
    shouldBackfillHistory: boolean,
  ): Promise<void> {
    await this.database.client.$transaction(async (transaction) => {
      await transaction.crmOperation.update({
        data: {
          resultSafe: {
            mode: result.mode,
            operationId: result.operationId,
            providerReference: result.providerReference,
          },
        },
        where: { id: operation.id },
      });
      if (operation.type === 'CREATE_OR_UPDATE_LEAD' && operation.contactId)
        await transaction.contact.update({
          data: { crmLeadId: result.providerReference },
          where: {
            projectId_id: { id: operation.contactId, projectId: operation.projectId },
          },
        });
      if (
        shouldBackfillHistory &&
        operation.type === 'CREATE_OR_UPDATE_LEAD' &&
        operation.contactId
      )
        await this.queueInitialHistory(
          transaction,
          operation.projectId,
          operation.contactId,
          operation.id,
        );
      await transaction.outboxRecord.updateMany({
        data: {
          completedAt: new Date(),
          lastError: null,
          lockedAt: null,
          lockedBy: null,
          nextAttemptAt: null,
          status: 'SUCCEEDED',
        },
        where: { id: outboxRecordId, lockedBy: leaseToken, status: 'PROCESSING' },
      });
    });
  }

  private async queueInitialHistory(
    transaction: Prisma.TransactionClient,
    projectId: string,
    contactId: string,
    sourceOperationId: string,
  ): Promise<void> {
    const messages = await transaction.message.findMany({
      orderBy: { createdAt: 'asc' },
      take: 50,
      where: {
        contactId,
        direction: 'INBOUND',
        normalizedEventId: { not: null },
        projectId,
      },
    });
    for (const message of messages) {
      if (!message.normalizedEventId) continue;
      const alreadyQueued = await transaction.crmOperation.findFirst({
        select: { id: true },
        where: {
          normalizedEventId: message.normalizedEventId,
          projectId,
          type: 'FORWARD_INBOUND_MESSAGE',
        },
      });
      if (alreadyQueued) continue;
      const idempotencyKey = `crm-history-${message.id}`;
      await transaction.outboxRecord.createMany({
        data: [
          {
            idempotencyKey,
            kind: 'CRM',
            payload: {},
            projectId,
          },
        ],
        skipDuplicates: true,
      });
      const outbox = await transaction.outboxRecord.findUnique({
        include: { crmOperation: { select: { id: true } } },
        where: { projectId_idempotencyKey: { idempotencyKey, projectId } },
      });
      if (!outbox || outbox.crmOperation) continue;
      const historyOperation = await transaction.crmOperation.create({
        data: {
          contactId,
          inputSafe: { source: 'initial_history', sourceOperationId },
          normalizedEventId: message.normalizedEventId,
          outboxRecordId: outbox.id,
          projectId,
          type: 'FORWARD_INBOUND_MESSAGE',
        },
      });
      await transaction.outboxRecord.update({
        data: { payload: { crmOperationId: historyOperation.id } },
        where: { projectId_id: { id: outbox.id, projectId } },
      });
    }
  }

  private async finish(
    outboxRecordId: string,
    leaseToken: string,
    status: 'FAILED' | 'UNKNOWN',
    error: string,
  ): Promise<void> {
    await this.database.client.outboxRecord.updateMany({
      data: {
        completedAt: new Date(),
        lastError: error,
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt: null,
        status,
      },
      where: { id: outboxRecordId, lockedBy: leaseToken, status: 'PROCESSING' },
    });
  }

  private customFields(contact: {
    customFields: Prisma.JsonValue;
    customFieldValues: Array<{
      definition: { key: string };
      valueJson: Prisma.JsonValue;
    }>;
  }): Record<string, unknown> {
    const legacy =
      contact.customFields &&
      typeof contact.customFields === 'object' &&
      !Array.isArray(contact.customFields)
        ? (contact.customFields as Record<string, unknown>)
        : {};
    return {
      ...legacy,
      ...Object.fromEntries(
        contact.customFieldValues.map((value) => [value.definition.key, value.valueJson]),
      ),
    };
  }

  private messageText(content: Prisma.JsonValue | undefined): string | undefined {
    if (!content || typeof content !== 'object' || Array.isArray(content)) return undefined;
    const record = content as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    return typeof record.caption === 'string' ? record.caption : undefined;
  }

  private async media(
    projectId: string,
    connectionId: string | null | undefined,
    asset:
      | {
          bucketKey: string | null;
          connectionId: string | null;
          declaredMimeType: string | null;
          detectedMimeType: string | null;
          extension: string | null;
          id: string;
          kind: string;
          originalFilename: string | null;
          providerMediaId: string | null;
          providerMetadata: Prisma.JsonValue | null;
          sizeBytes: bigint | null;
          status: string;
        }
      | null
      | undefined,
  ): Promise<{ media: CrmMediaInput } | undefined> {
    if (!asset) return undefined;
    let current = asset;
    if (
      current.status === 'PROVIDER_REFERENCE' &&
      connectionId &&
      current.connectionId === connectionId &&
      current.providerMediaId
    )
      current = await this.materializeTelegramMedia(projectId, connectionId, current);
    const size =
      current.sizeBytes !== null && current.sizeBytes <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(current.sizeBytes)
        : undefined;
    const download =
      current.status === 'AVAILABLE' && current.bucketKey && this.storage
        ? {
            downloadUrl: await this.storage.signedDownloadUrl(
              current.bucketKey,
              this.signedUrlTtlSeconds,
            ),
            downloadUrlExpiresAt: new Date(
              Date.now() + this.signedUrlTtlSeconds * 1_000,
            ).toISOString(),
          }
        : {};
    return {
      media: {
        assetId: current.id,
        ...download,
        ...(current.originalFilename ? { fileName: current.originalFilename } : {}),
        ...((current.detectedMimeType ?? current.declaredMimeType)
          ? { mimeType: current.detectedMimeType ?? current.declaredMimeType! }
          : {}),
        ...(size === undefined ? {} : { size }),
        kind: current.kind as CrmMediaInput['kind'],
        type:
          current.kind === 'PHOTO'
            ? 'image'
            : ['AUDIO', 'VOICE'].includes(current.kind)
              ? 'audio'
              : ['ANIMATION', 'VIDEO', 'VIDEO_NOTE'].includes(current.kind)
                ? 'video'
                : 'file',
      },
    };
  }

  private async interactive(
    projectId: string,
    connectionId: string | null | undefined,
    payload: Prisma.JsonValue | undefined,
  ): Promise<CrmInteractiveInput | undefined> {
    if (!connectionId || !payload || typeof payload !== 'object' || Array.isArray(payload))
      return undefined;
    const normalized = payload as Record<string, unknown>;
    const content =
      normalized.content &&
      typeof normalized.content === 'object' &&
      !Array.isArray(normalized.content)
        ? (normalized.content as Record<string, unknown>)
        : undefined;
    if (!content || typeof content.id !== 'string') return undefined;
    const data = typeof content.data === 'string' ? content.data : undefined;
    const metadata =
      normalized.metadata &&
      typeof normalized.metadata === 'object' &&
      !Array.isArray(normalized.metadata)
        ? (normalized.metadata as Record<string, unknown>)
        : undefined;
    const callback =
      metadata?.telegramCallbackQuery &&
      typeof metadata.telegramCallbackQuery === 'object' &&
      !Array.isArray(metadata.telegramCallbackQuery)
        ? (metadata.telegramCallbackQuery as Record<string, unknown>)
        : undefined;
    const sourceTelegramMessage =
      callback?.message && typeof callback.message === 'object' && !Array.isArray(callback.message)
        ? (callback.message as Record<string, unknown>)
        : undefined;
    const sourceProviderId =
      typeof sourceTelegramMessage?.message_id === 'number'
        ? String(sourceTelegramMessage.message_id)
        : undefined;
    const source = sourceProviderId
      ? await this.database.client.message.findFirst({
          select: { content: true, id: true, metadata: true },
          where: {
            connectionId,
            direction: 'OUTBOUND',
            externalMessageId: sourceProviderId,
            projectId,
          },
        })
      : undefined;
    const displayText = data
      ? this.callbackLabel(source?.content, source?.metadata, data)
      : undefined;
    return {
      callbackQueryId: content.id,
      ...(data === undefined ? {} : { data }),
      ...(displayText === undefined ? {} : { displayText }),
      ...(source?.id ? { sourceMessageId: source.id } : {}),
      type: 'callback_query',
    };
  }

  private callbackLabel(
    content: Prisma.JsonValue | undefined,
    metadata: Prisma.JsonValue | null | undefined,
    data: string,
  ): string | undefined {
    for (const value of [content, metadata]) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const keyboard = (value as Record<string, unknown>).inlineKeyboard;
      if (!Array.isArray(keyboard)) continue;
      for (const row of keyboard) {
        if (!Array.isArray(row)) continue;
        for (const candidate of row) {
          if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
          const button = candidate as Record<string, unknown>;
          if (button.callbackData === data && typeof button.text === 'string') return button.text;
        }
      }
    }
    return undefined;
  }

  private async materializeTelegramMedia(
    projectId: string,
    connectionId: string,
    asset: {
      bucketKey: string | null;
      connectionId: string | null;
      declaredMimeType: string | null;
      detectedMimeType: string | null;
      extension: string | null;
      id: string;
      kind: string;
      originalFilename: string | null;
      providerMediaId: string | null;
      providerMetadata: Prisma.JsonValue | null;
      sizeBytes: bigint | null;
      status: string;
    },
  ): Promise<typeof asset> {
    if (!this.storage || !asset.providerMediaId) return asset;
    try {
      const connection = await this.database.client.channelConnection.findUnique({
        where: { projectId_id: { id: connectionId, projectId } },
      });
      if (!connection) return asset;
      const token = this.secrets.decryptSecret({
        channelConnectionId: connection.id,
        channelType: 'telegram',
        envelope: connection.credentialsEncrypted as unknown as EncryptedSecretEnvelope,
        field: 'botToken',
        projectId,
      });
      const downloaded = await this.telegram.downloadFile(
        token,
        asset.providerMediaId,
        this.maximumMediaBytes,
      );
      const prepared = await prepareMediaForTelegram({
        bytes: downloaded.bytes,
        ...(asset.declaredMimeType ? { declaredMimeType: asset.declaredMimeType } : {}),
        ...(asset.originalFilename ? { filename: asset.originalFilename } : {}),
        kind: asset.kind as MediaKind,
        maximumBytes: this.maximumMediaBytes,
      });
      const bucketKey = `${projectId}/telegram/${asset.id}.${prepared.extension}`;
      await this.storage.putObject(bucketKey, prepared.bytes, prepared.mimeType, {
        assetId: asset.id,
        projectId,
      });
      return await this.database.client.mediaAsset.update({
        data: {
          availableAt: new Date(),
          bucketKey,
          checksumSha256: createHash('sha256').update(prepared.bytes).digest('hex'),
          detectedMimeType: prepared.mimeType,
          extension: prepared.extension,
          providerMetadata: {
            ...(asset.providerMetadata &&
            typeof asset.providerMetadata === 'object' &&
            !Array.isArray(asset.providerMetadata)
              ? asset.providerMetadata
              : {}),
            materializedFromTelegram: true,
          },
          retentionUntil: new Date(Date.now() + this.mediaRetentionDays * 86_400_000),
          sizeBytes: BigInt(prepared.sizeBytes),
          status: 'AVAILABLE',
        },
        where: { projectId_id: { id: asset.id, projectId } },
      });
    } catch {
      this.logger.warn({
        assetId: asset.id,
        message: 'crm_media_materialization_unavailable',
        projectId,
      });
      return asset;
    }
  }
}
