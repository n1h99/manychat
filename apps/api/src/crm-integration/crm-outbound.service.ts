import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@omnicus/database';

import { DatabaseService } from '../database/database.service';
import { TelegramOutboundQueueService } from '../channels/telegram-outbound-queue.service';
import type { CrmOutboundMessageDto } from './dto';

export interface CrmOutboundQueuedResult {
  messageId: string;
  operationId: string;
  replayed: boolean;
  status: 'QUEUED';
}

export interface CrmOutboundStatusResult {
  errorCode?: string;
  messageId: string;
  operationId: string;
  status: 'FAILED' | 'PROCESSING' | 'QUEUED' | 'SENT' | 'UNKNOWN';
}

@Injectable()
export class CrmOutboundService {
  private readonly logger = new Logger(CrmOutboundService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(TelegramOutboundQueueService)
    private readonly outboundQueue: TelegramOutboundQueueService,
  ) {}

  async queue(
    dto: CrmOutboundMessageDto,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<CrmOutboundQueuedResult> {
    const project = await this.database.client.project.findUnique({
      include: { crmConfig: true },
      where: { id: dto.omnicusProjectId },
    });
    if (
      !project ||
      project.status !== 'ACTIVE' ||
      !project.crmConfig?.enabled ||
      project.crmConfig.crmProjectId !== dto.crmProjectId
    )
      throw new NotFoundException({
        code: 'CRM_PROJECT_ROUTE_NOT_FOUND',
        message: 'CRM project route was not found',
      });

    const identity = await this.database.client.channelIdentity.findUnique({
      include: { connection: { select: { status: true, type: true } } },
      where: {
        projectId_id: {
          id: dto.identity.channelIdentityId,
          projectId: dto.omnicusProjectId,
        },
      },
    });
    if (
      !identity ||
      identity.contactId !== dto.omnicusContactId ||
      identity.connectionId !== dto.identity.connectionId ||
      identity.channel !== 'TELEGRAM' ||
      identity.connection.type !== 'TELEGRAM'
    )
      throw new NotFoundException({
        code: 'CRM_CHANNEL_IDENTITY_NOT_FOUND',
        message: 'CRM channel identity route was not found',
      });
    if (identity.status !== 'ACTIVE' || identity.connection.status !== 'ACTIVE')
      throw new ConflictException({
        code: 'CRM_CHANNEL_IDENTITY_UNAVAILABLE',
        message: 'CRM channel identity is unavailable',
      });

    const contact = await this.database.client.contact.findUnique({
      select: { crmLeadId: true, displayName: true },
      where: {
        projectId_id: {
          id: dto.omnicusContactId,
          projectId: dto.omnicusProjectId,
        },
      },
    });
    if (!contact)
      throw new NotFoundException({
        code: 'CRM_CONTACT_NOT_FOUND',
        message: 'CRM contact route was not found',
      });
    if (dto.crmLeadId && contact.crmLeadId && dto.crmLeadId !== contact.crmLeadId)
      throw new ConflictException({
        code: 'CRM_LEAD_MAPPING_CONFLICT',
        message: 'CRM lead mapping does not match',
      });

    const storedKey = `crm-to-telegram-${idempotencyKey}`;
    const existing = await this.existing(dto.omnicusProjectId, storedKey);
    if (existing) return { ...existing, replayed: true };

    let result: Omit<CrmOutboundQueuedResult, 'replayed'>;
    try {
      result = await this.database.client.$transaction(async (transaction) => {
        const conversation = await transaction.conversation.upsert({
          create: {
            connectionId: identity.connectionId,
            contactId: identity.contactId,
            externalChatId: identity.externalUserId,
            projectId: dto.omnicusProjectId,
          },
          update: {},
          where: {
            projectId_connectionId_externalChatId: {
              connectionId: identity.connectionId,
              externalChatId: identity.externalUserId,
              projectId: dto.omnicusProjectId,
            },
          },
        });
        const message = await transaction.message.create({
          data: {
            connectionId: identity.connectionId,
            contactId: identity.contactId,
            content: { text: dto.text },
            conversationId: conversation.id,
            direction: 'OUTBOUND',
            metadata: {
              disableNotification: dto.disableNotification ?? false,
              replyToMessageId: dto.replyToMessageId ?? null,
              source: 'crm',
            },
            projectId: dto.omnicusProjectId,
            status: 'QUEUED',
            type: 'TEXT',
          },
        });
        const outbox = await transaction.outboxRecord.create({
          data: {
            connectionId: identity.connectionId,
            idempotencyKey: storedKey,
            kind: 'TELEGRAM',
            nextAttemptAt: new Date(),
            payload: { channelIdentityId: identity.id, messageId: message.id },
            projectId: dto.omnicusProjectId,
          },
        });
        await transaction.idempotencyRecord.create({
          data: {
            key: idempotencyKey,
            projectId: dto.omnicusProjectId,
            scope: 'crm-to-telegram',
          },
        });
        await transaction.auditLog.create({
          data: {
            action: 'crm.outbound_message.queued',
            actorType: 'SERVICE',
            afterSafeJson: {
              connectionId: identity.connectionId,
              crmProjectId: dto.crmProjectId,
            },
            correlationId,
            entityId: outbox.id,
            entityType: 'OutboxRecord',
            projectId: dto.omnicusProjectId,
            projectNameSnapshot: project.name,
            projectSlugSnapshot: project.slug,
            purgeAfter: new Date(Date.now() + 180 * 24 * 60 * 60 * 1_000),
          },
        });
        return { messageId: message.id, operationId: outbox.id, status: 'QUEUED' as const };
      });
    } catch (error) {
      if (!this.isUniqueConstraint(error)) throw error;
      const replay = await this.existing(dto.omnicusProjectId, storedKey);
      if (!replay) throw error;
      return { ...replay, replayed: true };
    }

    try {
      await this.outboundQueue.enqueue(result.operationId);
    } catch {
      this.logger.warn({
        message: 'crm_outbound_enqueue_failed',
        operationId: result.operationId,
        projectId: dto.omnicusProjectId,
      });
    }
    return { ...result, replayed: false };
  }

  async status(
    operationId: string,
    crmProjectId: string,
    omnicusProjectId: string,
  ): Promise<CrmOutboundStatusResult> {
    const project = await this.database.client.project.findUnique({
      include: { crmConfig: true },
      where: { id: omnicusProjectId },
    });
    if (!project?.crmConfig?.enabled || project.crmConfig.crmProjectId !== crmProjectId)
      throw new NotFoundException({
        code: 'CRM_PROJECT_ROUTE_NOT_FOUND',
        message: 'CRM project route was not found',
      });
    const outbox = await this.database.client.outboxRecord.findUnique({
      where: { projectId_id: { id: operationId, projectId: omnicusProjectId } },
    });
    if (!outbox || outbox.kind !== 'TELEGRAM')
      throw new NotFoundException({
        code: 'CRM_OUTBOUND_OPERATION_NOT_FOUND',
        message: 'CRM outbound operation was not found',
      });
    const messageId = (outbox.payload as { messageId?: unknown }).messageId;
    if (typeof messageId !== 'string')
      throw new NotFoundException({
        code: 'CRM_OUTBOUND_OPERATION_NOT_FOUND',
        message: 'CRM outbound operation was not found',
      });
    const message = await this.database.client.message.findUnique({
      select: { status: true },
      where: { projectId_id: { id: messageId, projectId: omnicusProjectId } },
    });
    if (!message)
      throw new NotFoundException({
        code: 'CRM_OUTBOUND_MESSAGE_NOT_FOUND',
        message: 'CRM outbound message was not found',
      });
    const status =
      outbox.status === 'FAILED' || message.status === 'FAILED'
        ? 'FAILED'
        : outbox.status === 'UNKNOWN' || message.status === 'UNKNOWN'
          ? 'UNKNOWN'
          : outbox.status === 'SUCCEEDED' && message.status === 'SENT'
            ? 'SENT'
            : outbox.status === 'PROCESSING' || message.status === 'PROCESSING'
              ? 'PROCESSING'
              : 'QUEUED';
    return {
      ...(outbox.lastError ? { errorCode: outbox.lastError } : {}),
      messageId,
      operationId,
      status,
    };
  }

  private async existing(
    projectId: string,
    storedKey: string,
  ): Promise<Omit<CrmOutboundQueuedResult, 'replayed'> | undefined> {
    const record = await this.database.client.outboxRecord.findUnique({
      where: { projectId_idempotencyKey: { idempotencyKey: storedKey, projectId } },
    });
    if (!record) return undefined;
    const messageId = (record.payload as { messageId?: unknown }).messageId;
    if (typeof messageId !== 'string')
      throw new ConflictException({
        code: 'CRM_IDEMPOTENCY_RECORD_INVALID',
        message: 'CRM idempotency record is invalid',
      });
    return {
      messageId,
      operationId: record.id,
      status: 'QUEUED',
    };
  }

  private isUniqueConstraint(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
