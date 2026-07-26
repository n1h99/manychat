import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@omnicus/database';

import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import {
  ChannelConnectionService,
  type TelegramWebhookConnection,
} from './channel-connection.service';
import { TelegramInboundQueueService } from './telegram-inbound-queue.service';

const rawWebhookRetentionMilliseconds = 30 * 24 * 60 * 60 * 1_000;

export interface TelegramWebhookRequestContext {
  correlationId: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

interface StoredInboxEvent {
  inboxRecordId: string;
}

export interface TelegramWebhookResult {
  accepted: boolean;
  duplicate: boolean;
}

function isDuplicateUpdate(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }

  const target = Array.isArray(error.meta?.target) ? error.meta.target.join(',') : '';
  return target.includes('connectionId') && target.includes('externalUpdateId');
}

@Injectable()
export class TelegramWebhookService {
  private readonly logger = new Logger(TelegramWebhookService.name);

  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ChannelConnectionService) private readonly connections: ChannelConnectionService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(TelegramInboundQueueService) private readonly inboundQueue: TelegramInboundQueueService,
  ) {}

  async receive(
    connectionId: string,
    presentedSecret: string | undefined,
    payload: unknown,
    context: TelegramWebhookRequestContext,
  ): Promise<TelegramWebhookResult> {
    const connection = await this.connections.findActiveTelegramConnection(connectionId);
    const validSecret = await this.connections.verifyWebhookSecret(connection, presentedSecret);

    if (!validSecret) {
      await this.recordInvalidSecret(connection, context);
      return { accepted: false, duplicate: false };
    }

    const externalUpdateId = this.updateId(payload);
    const stored = await this.persist(connection, externalUpdateId, payload, context.correlationId);
    try {
      await this.connections.markWebhookReceived(connection.id);
    } catch {
      this.logger.warn({
        connectionId: connection.id,
        correlationId: context.correlationId,
        message: 'Telegram webhook timestamp update failed',
        projectId: connection.projectId,
      });
    }

    if (stored) {
      try {
        await this.inboundQueue.enqueue(stored.inboxRecordId);
      } catch {
        await this.recordEnqueueFailure(connection, stored.inboxRecordId, context.correlationId);
        this.logger.warn({
          connectionId: connection.id,
          correlationId: context.correlationId,
          inboxRecordId: stored.inboxRecordId,
          message: 'Telegram inbound enqueue failed; inbox record remains pending',
          projectId: connection.projectId,
        });
      }
    }

    return { accepted: true, duplicate: stored === null };
  }

  private async persist(
    connection: TelegramWebhookConnection,
    externalUpdateId: string,
    payload: unknown,
    correlationId: string,
  ): Promise<StoredInboxEvent | null> {
    const receivedAt = new Date();

    try {
      return await this.database.client.$transaction(async (transaction) => {
        const rawWebhookEvent = await transaction.rawWebhookEvent.create({
          data: {
            connectionId: connection.id,
            correlationId,
            externalUpdateId,
            payload: payload as Prisma.InputJsonValue,
            projectId: connection.projectId,
            purgeAfter: new Date(receivedAt.getTime() + rawWebhookRetentionMilliseconds),
            receivedAt,
            status: 'RECEIVED',
          },
        });
        const inboxRecord = await transaction.inboxRecord.create({
          data: {
            attempts: 0,
            connectionId: connection.id,
            completedAt: null,
            lastError: null,
            lockedAt: null,
            lockedBy: null,
            maxAttempts: 8,
            nextAttemptAt: receivedAt,
            projectId: connection.projectId,
            rawWebhookEventId: rawWebhookEvent.id,
            status: 'PENDING',
          },
          select: { id: true },
        });
        return { inboxRecordId: inboxRecord.id };
      });
    } catch (error) {
      if (isDuplicateUpdate(error)) {
        return null;
      }
      throw error;
    }
  }

  private async recordInvalidSecret(
    connection: TelegramWebhookConnection,
    context: TelegramWebhookRequestContext,
  ): Promise<void> {
    this.logger.warn({
      connectionId: connection.id,
      correlationId: context.correlationId,
      message: 'Telegram webhook secret rejected',
      projectId: connection.projectId,
    });

    try {
      await this.audit.record({
        action: 'security.webhook_secret_rejected',
        actorType: 'SYSTEM',
        correlationId: context.correlationId,
        entityId: connection.id,
        entityType: 'ChannelConnection',
        ip: context.ip,
        projectId: connection.projectId,
        reason: 'invalid_or_missing_telegram_webhook_secret',
        userAgent: context.userAgent,
      });
    } catch {
      this.logger.error({
        connectionId: connection.id,
        correlationId: context.correlationId,
        message: 'Telegram webhook security audit could not be persisted',
        projectId: connection.projectId,
      });
    }
  }

  private async recordEnqueueFailure(
    connection: TelegramWebhookConnection,
    inboxRecordId: string,
    correlationId: string,
  ): Promise<void> {
    try {
      await this.database.client.inboxRecord.update({
        data: { lastError: 'telegram_inbound_enqueue_failed' },
        where: { projectId_id: { id: inboxRecordId, projectId: connection.projectId } },
      });
    } catch {
      this.logger.error({
        connectionId: connection.id,
        correlationId,
        inboxRecordId,
        message: 'Telegram inbound enqueue failure could not be recorded',
        projectId: connection.projectId,
      });
    }
  }

  private updateId(payload: unknown): string {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('update_id' in payload) ||
      typeof payload.update_id !== 'number' ||
      !Number.isSafeInteger(payload.update_id) ||
      payload.update_id < 0
    ) {
      throw new BadRequestException({
        code: 'TELEGRAM_UPDATE_INVALID',
        message: 'Telegram update_id is required',
      });
    }

    return String(payload.update_id);
  }
}
