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
import type {
  CrmOutboundMessageDto,
  CrmScheduledMessageDto,
  CrmScheduledMessageQueryDto,
} from './dto';

export interface CrmOutboundQueuedResult {
  channelIdentityId?: string;
  connectionId?: string;
  crmLeadId?: string | null;
  messageId: string;
  omnicusContactId?: string;
  operationId: string;
  replayed: boolean;
  status: 'QUEUED';
  scheduleId?: string;
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
    dto: CrmOutboundMessageDto | CrmScheduledMessageDto,
    idempotencyKey: string,
    correlationId: string,
    authenticatedProjectId?: string,
  ): Promise<CrmOutboundQueuedResult> {
    const structured = this.structured(dto.structured);
    if (structured && (dto.text !== undefined || dto.media !== undefined))
      throw new ConflictException({ code: 'CRM_STRUCTURED_MESSAGE_CONFLICT' });
    const schedule =
      'scheduledAt' in dto
        ? { scheduledAt: new Date(dto.scheduledAt), timezone: dto.timezone }
        : undefined;
    if (schedule) {
      if (
        Number.isNaN(schedule.scheduledAt.getTime()) ||
        schedule.scheduledAt.getTime() <= Date.now()
      )
        throw new ConflictException({ code: 'CRM_SCHEDULE_TIME_INVALID' });
      try {
        new Intl.DateTimeFormat('en', { timeZone: schedule.timezone }).format(schedule.scheduledAt);
      } catch {
        throw new ConflictException({ code: 'CRM_SCHEDULE_TIMEZONE_INVALID' });
      }
    }
    if (
      dto.media?.kind === 'STICKER' &&
      (dto.text !== undefined || dto.entities !== undefined || dto.linkPreviewOptions !== undefined)
    )
      throw new ConflictException({
        code: 'CRM_STICKER_CAPTION_UNSUPPORTED',
        message: 'Sticker messages cannot have a caption',
      });
    if (dto.hasSpoiler && !['ANIMATION', 'PHOTO', 'VIDEO'].includes(dto.media?.kind ?? ''))
      throw new ConflictException({
        code: 'CRM_MEDIA_SPOILER_UNSUPPORTED',
        message: 'Media spoiler is unavailable for this media kind',
      });
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

    const storedKey = `${schedule ? 'crm-scheduled' : 'crm-to-telegram'}-${idempotencyKey}`;
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
        if (!dto.text && !mediaAsset && !structured)
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
            content: (structured
              ? { structured }
              : mediaAsset
                ? {
                    caption: ['STICKER', 'VIDEO_NOTE'].includes(dto.media?.kind ?? '')
                      ? ''
                      : (dto.text ?? ''),
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
              ...(dto.hasSpoiler ? { hasSpoiler: true } : {}),
              ...(inlineKeyboard ? { inlineKeyboard } : {}),
              ...(linkPreviewOptions ? { linkPreviewOptions } : {}),
              ...(dto.messageEffectId ? { messageEffectId: dto.messageEffectId } : {}),
              protectContent: dto.protectContent ?? false,
              ...(dto.replyToMessageId ? { replyToOmnicusMessageId: dto.replyToMessageId } : {}),
              replyToMessageId: providerReplyMessageId ?? null,
              ...(dto.quote ? { quote: dto.quote } : {}),
              ...(dto.quotePosition === undefined ? {} : { quotePosition: dto.quotePosition }),
              source: 'crm',
            } as unknown as Prisma.InputJsonValue,
            projectId: dto.omnicusProjectId,
            status: 'QUEUED',
            type:
              structured?.type === 'contact'
                ? 'CONTACT'
                : structured?.type === 'location'
                  ? 'LOCATION'
                  : structured?.type === 'poll'
                    ? 'POLL'
                    : (dto.media?.kind ?? 'TEXT'),
          },
        });
        const outbox = await transaction.outboxRecord.create({
          data: {
            connectionId: identity.connectionId,
            idempotencyKey: storedKey,
            kind: 'TELEGRAM',
            nextAttemptAt: schedule?.scheduledAt ?? new Date(),
            payload: { channelIdentityId: identity.id, messageId: message.id },
            projectId: dto.omnicusProjectId,
          },
        });
        const scheduledMessage = schedule
          ? await transaction.scheduledMessage.create({
              data: {
                channelIdentityId: identity.id,
                connectionId: identity.connectionId,
                contactId: identity.contactId,
                messageId: message.id,
                occurrence: 1,
                outboxRecordId: outbox.id,
                projectId: dto.omnicusProjectId,
                request: {
                  kind: dto.media?.kind ?? 'TEXT',
                  ...(dto.text ? { text: dto.text } : {}),
                },
                scheduledAt: schedule.scheduledAt,
                seriesId: outbox.id,
                timezone: schedule.timezone,
              },
            })
          : undefined;
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
        return {
          ...(scheduledMessage
            ? {
                channelIdentityId: identity.id,
                connectionId: identity.connectionId,
                crmLeadId: contact.crmLeadId,
                omnicusContactId: identity.contactId,
              }
            : {}),
          messageId: message.id,
          operationId: outbox.id,
          ...(scheduledMessage ? { scheduleId: scheduledMessage.id } : {}),
          status: 'QUEUED' as const,
        };
      });
    } catch (error) {
      if (!this.isUniqueConstraint(error)) throw error;
      const replay = await this.existing(dto.omnicusProjectId, storedKey);
      if (!replay) throw error;
      return { ...replay, replayed: true };
    }

    try {
      if (!schedule) await this.outboundQueue.enqueue(result.operationId);
    } catch {
      this.logger.warn({
        message: 'crm_outbound_enqueue_failed',
        operationId: result.operationId,
        projectId: dto.omnicusProjectId,
      });
    }
    return { ...result, replayed: false };
  }

  async scheduled(
    scheduleId: string,
    query: CrmScheduledMessageQueryDto,
    authenticatedProjectId?: string,
  ) {
    await this.assertProjectRoute(
      query.crmProjectId,
      query.omnicusProjectId,
      authenticatedProjectId,
    );
    const schedule = await this.database.client.scheduledMessage.findFirst({
      select: {
        cancelledAt: true,
        channelIdentityId: true,
        completedAt: true,
        connectionId: true,
        contact: { select: { crmLeadId: true } },
        contactId: true,
        id: true,
        messageId: true,
        occurrence: true,
        outboxRecordId: true,
        scheduledAt: true,
        seriesId: true,
        status: true,
        timezone: true,
      },
      where: { id: scheduleId, ...this.scheduleScope(query) },
    });
    if (!schedule) throw new NotFoundException({ code: 'CRM_SCHEDULE_NOT_FOUND' });
    return this.scheduleResponse(schedule);
  }

  async scheduledList(query: CrmScheduledMessageQueryDto, authenticatedProjectId?: string) {
    await this.assertProjectRoute(
      query.crmProjectId,
      query.omnicusProjectId,
      authenticatedProjectId,
    );
    const schedules = await this.database.client.scheduledMessage.findMany({
      orderBy: [{ scheduledAt: 'desc' }, { id: 'desc' }],
      select: {
        cancelledAt: true,
        channelIdentityId: true,
        completedAt: true,
        connectionId: true,
        contact: { select: { crmLeadId: true } },
        contactId: true,
        id: true,
        messageId: true,
        occurrence: true,
        outboxRecordId: true,
        scheduledAt: true,
        seriesId: true,
        status: true,
        timezone: true,
      },
      take: 100,
      where: this.scheduleScope(query),
    });
    return schedules.map((schedule) => this.scheduleResponse(schedule));
  }

  async cancelScheduled(
    scheduleId: string,
    query: CrmScheduledMessageQueryDto,
    authenticatedProjectId?: string,
  ) {
    await this.assertProjectRoute(
      query.crmProjectId,
      query.omnicusProjectId,
      authenticatedProjectId,
    );
    return this.database.client.$transaction(async (transaction) => {
      const schedule = await transaction.scheduledMessage.findFirst({
        include: { contact: { select: { crmLeadId: true } } },
        where: { id: scheduleId, ...this.scheduleScope(query) },
      });
      if (!schedule) throw new NotFoundException({ code: 'CRM_SCHEDULE_NOT_FOUND' });
      if (schedule.status === 'CANCELLED')
        return {
          ...this.scheduleRouting(schedule),
          id: schedule.id,
          replayed: true,
          status: 'CANCELLED' as const,
        };
      if (schedule.status !== 'QUEUED')
        throw new ConflictException({ code: 'CRM_SCHEDULE_NOT_CANCELLABLE' });
      const cancelled = await transaction.scheduledMessage.updateMany({
        data: { cancelledAt: new Date(), status: 'CANCELLED' },
        where: { id: schedule.id, projectId: query.omnicusProjectId, status: 'QUEUED' },
      });
      if (cancelled.count !== 1)
        throw new ConflictException({ code: 'CRM_SCHEDULE_NOT_CANCELLABLE' });
      await transaction.outboxRecord.updateMany({
        data: {
          completedAt: new Date(),
          lastError: 'scheduled_message_cancelled',
          nextAttemptAt: null,
          status: 'FAILED',
        },
        where: {
          id: schedule.outboxRecordId,
          projectId: query.omnicusProjectId,
          status: 'PENDING',
        },
      });
      await transaction.message.updateMany({
        data: { failedAt: new Date(), status: 'FAILED' },
        where: { id: schedule.messageId, projectId: query.omnicusProjectId, status: 'QUEUED' },
      });
      return {
        ...this.scheduleRouting(schedule),
        id: schedule.id,
        replayed: false,
        status: 'CANCELLED' as const,
      };
    });
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
    const mediaGroupId = (outbox.payload as { mediaGroupId?: unknown }).mediaGroupId;
    if (typeof mediaGroupId === 'string') {
      const group = await this.database.client.telegramMediaGroup.findUnique({
        where: { projectId_id: { id: mediaGroupId, projectId: omnicusProjectId } },
      });
      if (!group) throw new NotFoundException({ code: 'CRM_MEDIA_GROUP_NOT_FOUND' });
      return {
        ...(outbox.lastError ? { errorCode: outbox.lastError } : {}),
        messageId: group.id,
        operationId,
        status:
          group.status === 'SENT'
            ? 'SENT'
            : group.status === 'PROCESSING'
              ? 'PROCESSING'
              : group.status,
      } as CrmOutboundStatusResult;
    }
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
    const schedule = await this.database.client.scheduledMessage.findUnique({
      select: {
        channelIdentityId: true,
        connectionId: true,
        contact: { select: { crmLeadId: true } },
        contactId: true,
        id: true,
      },
      where: {
        projectId_outboxRecordId: { outboxRecordId: record.id, projectId },
      },
    });
    return {
      ...(schedule ? this.scheduleRouting(schedule) : {}),
      messageId,
      operationId: record.id,
      ...(schedule ? { scheduleId: schedule.id } : {}),
      status: 'QUEUED',
    };
  }

  private scheduleScope(query: CrmScheduledMessageQueryDto): Prisma.ScheduledMessageWhereInput {
    return {
      connectionId: query.connectionId,
      contactId: query.omnicusContactId,
      projectId: query.omnicusProjectId,
      ...(query.channelIdentityId ? { channelIdentityId: query.channelIdentityId } : {}),
      ...(query.crmLeadId ? { contact: { crmLeadId: query.crmLeadId } } : {}),
    };
  }

  private scheduleRouting(schedule: {
    channelIdentityId: string;
    connectionId: string;
    contact: { crmLeadId: string | null };
    contactId: string;
  }) {
    return {
      channelIdentityId: schedule.channelIdentityId,
      connectionId: schedule.connectionId,
      crmLeadId: schedule.contact.crmLeadId,
      omnicusContactId: schedule.contactId,
    };
  }

  private scheduleResponse<T extends Parameters<CrmOutboundService['scheduleRouting']>[0]>(
    schedule: T,
  ) {
    const safe = { ...schedule };
    Reflect.deleteProperty(safe, 'contact');
    Reflect.deleteProperty(safe, 'contactId');
    return { ...safe, ...this.scheduleRouting(schedule) };
  }

  private isUniqueConstraint(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private structured(value: Record<string, unknown> | undefined):
    | {
        firstName: string;
        lastName?: string;
        phoneNumber: string;
        type: 'contact';
        vcard?: string;
      }
    | {
        horizontalAccuracy?: number;
        latitude: number;
        longitude: number;
        type: 'location';
      }
    | {
        allowsMultipleAnswers?: boolean;
        isAnonymous?: boolean;
        options: string[];
        question: string;
        type: 'poll';
      }
    | undefined {
    if (!value) return undefined;
    if (
      value.type === 'contact' &&
      typeof value.firstName === 'string' &&
      value.firstName.length > 0 &&
      value.firstName.length <= 64 &&
      typeof value.phoneNumber === 'string' &&
      value.phoneNumber.length > 0 &&
      value.phoneNumber.length <= 64
    )
      return {
        firstName: value.firstName,
        phoneNumber: value.phoneNumber,
        type: 'contact',
        ...(typeof value.lastName === 'string' ? { lastName: value.lastName } : {}),
        ...(typeof value.vcard === 'string' ? { vcard: value.vcard } : {}),
      };
    if (
      value.type === 'location' &&
      typeof value.latitude === 'number' &&
      value.latitude >= -90 &&
      value.latitude <= 90 &&
      typeof value.longitude === 'number' &&
      value.longitude >= -180 &&
      value.longitude <= 180
    )
      return {
        latitude: value.latitude,
        longitude: value.longitude,
        type: 'location',
        ...(typeof value.horizontalAccuracy === 'number'
          ? { horizontalAccuracy: value.horizontalAccuracy }
          : {}),
      };
    if (
      value.type === 'poll' &&
      typeof value.question === 'string' &&
      value.question.length > 0 &&
      value.question.length <= 300 &&
      Array.isArray(value.options) &&
      value.options.length >= 2 &&
      value.options.length <= 12 &&
      value.options.every(
        (option) => typeof option === 'string' && option.length > 0 && option.length <= 100,
      )
    )
      return {
        options: value.options as string[],
        question: value.question,
        type: 'poll',
        ...(typeof value.allowsMultipleAnswers === 'boolean'
          ? { allowsMultipleAnswers: value.allowsMultipleAnswers }
          : {}),
        ...(typeof value.isAnonymous === 'boolean' ? { isAnonymous: value.isAnonymous } : {}),
      };
    throw new ConflictException({ code: 'CRM_STRUCTURED_MESSAGE_INVALID' });
  }
}
