import { randomUUID } from 'node:crypto';

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WorkerEnvironment } from '@omnicus/config/server';
import {
  CrmClientError,
  type CrmClient,
  type CrmIdentityInput,
  type CrmMediaInput,
} from '@omnicus/crm-core';
import type { Prisma } from '@omnicus/database';

import { DatabaseService } from '../database/database.service';
import { CRM_CLIENT } from './crm.tokens';

@Injectable()
export class CrmOutboxService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CrmOutboxService.name);
  private readonly workerId = `crm-outbox-${process.pid}-${randomUUID()}`;
  private timer: NodeJS.Timeout | undefined;
  private scanning = false;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<WorkerEnvironment, true>,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CRM_CLIENT) private readonly client: CrmClient,
  ) {}

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
    const inboundText = this.messageText(operation.normalizedEvent?.message?.content);

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
              ...(this.media(operation.normalizedEvent?.message?.mediaAsset) ?? {}),
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
      await this.finishSuccess(operation, outboxRecordId, leaseToken, result);
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

  private media(
    asset:
      | {
          declaredMimeType: string | null;
          id: string;
          kind: string;
          originalFilename: string | null;
          sizeBytes: bigint | null;
        }
      | null
      | undefined,
  ): { media: CrmMediaInput } | undefined {
    if (!asset) return undefined;
    const size =
      asset.sizeBytes !== null && asset.sizeBytes <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(asset.sizeBytes)
        : undefined;
    return {
      media: {
        assetId: asset.id,
        ...(asset.originalFilename ? { fileName: asset.originalFilename } : {}),
        ...(asset.declaredMimeType ? { mimeType: asset.declaredMimeType } : {}),
        ...(size === undefined ? {} : { size }),
        type: asset.kind === 'PHOTO' ? 'image' : 'file',
      },
    };
  }
}
