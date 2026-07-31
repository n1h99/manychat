import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  type TelegramInlineKeyboard,
  type TelegramLinkPreviewOptions,
  type TelegramMessageEntity,
  validateTelegramInlineKeyboard,
  validateTelegramLinkPreviewOptions,
  validateTelegramMessageEntities,
} from '@omnicus/channel-telegram';
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
  status: 'FAILED' | 'PROCESSING' | 'QUEUED' | 'SENT' | 'SUCCEEDED' | 'UNKNOWN';
}

@Injectable()
export class CrmOutboundService {
  private readonly logger = new Logger(CrmOutboundService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(TelegramOutboundQueueService)
    private readonly outboundQueue: TelegramOutboundQueueService,
  ) {}

  async connectionStatus(authenticatedProjectId?: string) {
    if (!authenticatedProjectId) return { mode: 'legacy', status: 'ACTIVE' as const };
    const connection = await this.database.client.crmProjectConfig.findUnique({
      select: {
        crmProjectId: true,
        projectId: true,
        provider: true,
        status: true,
      },
      where: { projectId: authenticatedProjectId },
    });
    if (!connection || connection.status !== 'ACTIVE')
      throw new NotFoundException({ code: 'CRM_CONNECTION_NOT_FOUND' });
    return connection;
  }

  async assertProjectRoute(
    crmProjectId: string,
    omnicusProjectId: string,
    authenticatedProjectId?: string,
  ): Promise<void> {
    const project = await this.database.client.project.findUnique({
      include: { crmConfig: true },
      where: { id: omnicusProjectId },
    });
    if (
      (authenticatedProjectId !== undefined && authenticatedProjectId !== omnicusProjectId) ||
      !project ||
      project.status !== 'ACTIVE' ||
      !project.crmConfig?.enabled ||
      project.crmConfig.crmProjectId !== crmProjectId
    )
      throw new NotFoundException({
        code: 'CRM_PROJECT_ROUTE_NOT_FOUND',
        message: 'CRM project route was not found',
      });
  }

  async queue(
    dto: CrmOutboundMessageDto,
    idempotencyKey: string,
    correlationId: string,
    authenticatedProjectId?: string,
  ): Promise<CrmOutboundQueuedResult> {
    const project = await this.database.client.project.findUnique({
      include: { crmConfig: true },
      where: { id: dto.omnicusProjectId },
    });
    if (
      (authenticatedProjectId !== undefined && authenticatedProjectId !== dto.omnicusProjectId) ||
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
        const mediaAsset = dto.media
          ? await transaction.mediaAsset.findFirst({
              select: { id: true, kind: true },
              where: {
                id: dto.media.mediaAssetId,
                kind: dto.media.kind,
                projectId: dto.omnicusProjectId,
                status: 'AVAILABLE',
              },
            })
          : undefined;
        if (dto.media && !mediaAsset)
          throw new NotFoundException({
            code: 'CRM_MEDIA_ASSET_NOT_FOUND',
            message: 'CRM media asset was not found',
          });
        if (!dto.text && !mediaAsset)
          throw new ConflictException({
            code: 'CRM_OUTBOUND_CONTENT_REQUIRED',
            message: 'Text or media is required',
          });
        let inlineKeyboard: TelegramInlineKeyboard | undefined;
        if (dto.inlineKeyboard !== undefined)
          try {
            inlineKeyboard = validateTelegramInlineKeyboard(dto.inlineKeyboard);
          } catch {
            throw new ConflictException({
              code: 'CRM_INLINE_KEYBOARD_INVALID',
              message: 'Inline keyboard is invalid',
            });
          }
        let entities: TelegramMessageEntity[] | undefined;
        if (dto.entities !== undefined)
          try {
            entities = validateTelegramMessageEntities(
              dto.entities,
              dto.text ?? (dto.media ? '' : ''),
            );
          } catch {
            throw new ConflictException({
              code: 'CRM_MESSAGE_ENTITIES_INVALID',
              message: 'Message entities are invalid',
            });
          }
        let linkPreviewOptions: TelegramLinkPreviewOptions | undefined;
        if (dto.linkPreviewOptions !== undefined)
          try {
            linkPreviewOptions = validateTelegramLinkPreviewOptions(dto.linkPreviewOptions);
          } catch {
            throw new ConflictException({
              code: 'CRM_LINK_PREVIEW_OPTIONS_INVALID',
              message: 'Link preview options are invalid',
            });
          }
        let providerReplyMessageId: string | undefined;
        if (dto.replyToMessageId) {
          const reply = await transaction.message.findFirst({
            select: { externalMessageId: true },
            where: {
              connectionId: identity.connectionId,
              conversationId: conversation.id,
              externalMessageId: { not: null },
              id: dto.replyToMessageId,
              projectId: dto.omnicusProjectId,
            },
          });
          if (!reply?.externalMessageId)
            throw new NotFoundException({
              code: 'CRM_REPLY_MESSAGE_NOT_FOUND',
              message: 'Reply target was not found',
            });
          providerReplyMessageId = reply.externalMessageId;
        }
        const message = await transaction.message.create({
          data: {
            connectionId: identity.connectionId,
            contactId: identity.contactId,
            content: (mediaAsset
              ? {
                  caption: dto.media?.kind === 'VIDEO_NOTE' ? '' : (dto.text ?? ''),
                  ...(inlineKeyboard ? { inlineKeyboard } : {}),
                }
              : {
                  text: dto.text!,
                  ...(inlineKeyboard ? { inlineKeyboard } : {}),
                }) as unknown as Prisma.InputJsonValue,
            conversationId: conversation.id,
            direction: 'OUTBOUND',
            mediaAssetId: mediaAsset?.id ?? null,
            metadata: {
              disableNotification: dto.disableNotification ?? false,
              ...(entities ? { entities } : {}),
              ...(inlineKeyboard ? { inlineKeyboard } : {}),
              ...(linkPreviewOptions ? { linkPreviewOptions } : {}),
              ...(dto.messageEffectId ? { messageEffectId: dto.messageEffectId } : {}),
              protectContent: dto.protectContent ?? false,
              replyToMessageId: providerReplyMessageId ?? null,
              ...(dto.quote ? { quote: dto.quote } : {}),
              ...(dto.quotePosition === undefined ? {} : { quotePosition: dto.quotePosition }),
              source: 'crm',
            } as unknown as Prisma.InputJsonValue,
            projectId: dto.omnicusProjectId,
            status: 'QUEUED',
            type: dto.media?.kind ?? 'TEXT',
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
    authenticatedProjectId?: string,
  ): Promise<CrmOutboundStatusResult> {
    const project = await this.database.client.project.findUnique({
      include: { crmConfig: true },
      where: { id: omnicusProjectId },
    });
    if (
      (authenticatedProjectId !== undefined && authenticatedProjectId !== omnicusProjectId) ||
      !project?.crmConfig?.enabled ||
      project.crmConfig.crmProjectId !== crmProjectId
    )
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
    const action = (outbox.payload as { action?: unknown }).action;
    const isMessageMutation =
      typeof action === 'string' &&
      ['DELETE_MESSAGE', 'EDIT_MESSAGE', 'PIN_MESSAGE', 'SET_REACTION'].includes(action);
    const status =
      outbox.status === 'FAILED' || message.status === 'FAILED'
        ? 'FAILED'
        : outbox.status === 'UNKNOWN' || message.status === 'UNKNOWN'
          ? 'UNKNOWN'
          : outbox.status === 'SUCCEEDED' && isMessageMutation
            ? 'SUCCEEDED'
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
