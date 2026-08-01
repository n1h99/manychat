import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelSecretsService, type EncryptedSecretEnvelope } from '@omnicus/channel-secrets';
import {
  TelegramAdapter,
  TelegramHttpTransport,
  type TelegramMessageEntity,
  type TelegramReaction,
  validateTelegramInlineKeyboard,
  validateTelegramLinkPreviewOptions,
  validateTelegramMessageEntities,
} from '@omnicus/channel-telegram';
import type { ApiEnvironment } from '@omnicus/config/server';
import { Prisma } from '@omnicus/database';

import { TelegramOutboundQueueService } from '../channels/telegram-outbound-queue.service';
import { DatabaseService } from '../database/database.service';
import type {
  CrmCapabilitiesQueryDto,
  CrmAutomationStateDto,
  CrmAutomationStateQueryDto,
  CrmChatActionDto,
  CrmDraftDto,
  CrmMessageMutationDto,
  CrmPinMessageDto,
  CrmReactionDto,
  CrmRetryOperationDto,
  CrmTelegramScopeDto,
} from './dto';

type V3Action = 'DELETE_MESSAGE' | 'EDIT_MESSAGE' | 'PIN_MESSAGE' | 'SET_REACTION';

@Injectable()
export class CrmTelegramV3Service {
  private readonly adapter = new TelegramAdapter(new TelegramHttpTransport());
  private readonly logger = new Logger(CrmTelegramV3Service.name);
  private readonly secrets: ChannelSecretsService;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(TelegramOutboundQueueService)
    private readonly outboundQueue: TelegramOutboundQueueService,
    @Inject(ConfigService) config: ConfigService<ApiEnvironment, true>,
  ) {
    this.secrets = new ChannelSecretsService(config.get('CHANNEL_SECRETS_KEY', { infer: true }));
  }

  async capabilities(query: CrmCapabilitiesQueryDto, authenticatedProjectId?: string) {
    await this.assertProject(query.crmProjectId, query.omnicusProjectId, authenticatedProjectId);
    const connection = await this.database.client.channelConnection.findUnique({
      select: { id: true, status: true, type: true },
      where: {
        projectId_id: { id: query.connectionId, projectId: query.omnicusProjectId },
      },
    });
    if (!connection || connection.type !== 'TELEGRAM')
      throw new NotFoundException({ code: 'CONNECTION_NOT_FOUND' });
    if (query.channelIdentityId || query.omnicusContactId) {
      const identity = query.channelIdentityId
        ? await this.database.client.channelIdentity.findUnique({
            where: {
              projectId_id: {
                id: query.channelIdentityId,
                projectId: query.omnicusProjectId,
              },
            },
          })
        : await this.database.client.channelIdentity.findFirst({
            where: {
              connectionId: query.connectionId,
              ...(query.omnicusContactId ? { contactId: query.omnicusContactId } : {}),
              projectId: query.omnicusProjectId,
            },
          });
      if (
        !identity ||
        identity.connectionId !== query.connectionId ||
        (query.omnicusContactId && identity.contactId !== query.omnicusContactId)
      )
        throw new NotFoundException({ code: 'CHANNEL_IDENTITY_NOT_FOUND' });
    }
    const unavailable = connection.status !== 'ACTIVE';
    const supported = (limits?: Record<string, unknown>) => ({
      supported: !unavailable,
      ...(unavailable ? { reasonCode: 'CONNECTION_NOT_ACTIVE' } : {}),
      ...(limits ? { limits } : {}),
    });
    return {
      capabilities: {
        automationManualMode: supported(),
        automationPausedMode: {
          supported: false,
          reasonCode: 'PAUSED_MODE_NOT_RELEASED',
        },
        chatActions: supported({ ttlSeconds: 5 }),
        deleteMessage: supported({ maximumAgeHours: 48 }),
        editMessage: supported({
          editableFields: ['text', 'caption', 'entities', 'inlineKeyboard', 'linkPreviewOptions'],
          immutableFields: [
            'protectContent',
            'messageEffectId',
            'replyToMessageId',
            'quote',
            'quotePosition',
          ],
          maximumTextLength: 4096,
          omissionSemantics: {
            entities: 'cleared_when_text_or_caption_is_replaced_without_entities',
            inlineKeyboard: 'preserved_when_omitted',
            linkPreviewOptions: 'telegram_default_when_omitted',
          },
          preservedFields: [
            'protectContent',
            'messageEffectId',
            'replyToMessageId',
            'quote',
            'quotePosition',
          ],
        }),
        explicitRetry: supported({ terminalStatus: 'FAILED', unknownRequires: 'reconciliation' }),
        externalDeletionEvents: {
          supported: false,
          reasonCode: 'BOT_API_NO_DELETE_EVENT',
        },
        formattingEntities: supported({ offsets: 'UTF-16' }),
        inlineKeyboard: supported({ maximumButtonsPerRow: 8, maximumRows: 8 }),
        linkPreviewOptions: supported({ allowedProtocols: 'http,https' }),
        mediaGroups: { supported: false, reasonCode: 'MEDIA_GROUP_NOT_RELEASED' },
        mediaSpoilers: supported({ mediaKinds: ['ANIMATION', 'PHOTO', 'VIDEO'] }),
        messageEffects: supported({
          availableEffects: [],
          catalogAvailable: false,
          catalogReasonCode: 'BOT_API_EFFECT_CATALOG_UNAVAILABLE',
          editable: false,
          privateChatsOnly: true,
          repeatableOnNewMessages: true,
        }),
        botInterface: { supported: false, reasonCode: 'BOT_INTERFACE_NOT_RELEASED' },
        externalActions: { supported: false, reasonCode: 'EXTERNAL_ACTIONS_NOT_RELEASED' },
        pinMessage: supported(),
        protectContent: supported(),
        quote: supported({ maximumLength: 1024, requiresReplyToMessage: true }),
        reactions: supported({ maximumBotReactions: 1, paidReactions: false }),
        userReactionEvents: {
          supported: false,
          reasonCode: 'CRM_REACTION_ENDPOINT_NOT_LIVE_VERIFIED',
          limits: { contractPublished: true, privateChatsOnly: true },
        },
        scheduling: { supported: false, reasonCode: 'APPLICATION_SCHEDULER_NOT_RELEASED' },
        stickers: supported({
          animatedMaximumBytes: 64 * 1024,
          captions: false,
          formats: ['TGS', 'WEBM', 'WEBP'],
          staticMaximumBytes: 512 * 1024,
          videoMaximumBytes: 256 * 1024,
        }),
        structuredMessages: {
          supported: false,
          reasonCode: 'STRUCTURED_MESSAGES_NOT_RELEASED',
        },
        replyKeyboard: { supported: false, reasonCode: 'REPLY_KEYBOARD_NOT_RELEASED' },
        richMessages: { supported: false, reasonCode: 'RICH_MESSAGES_NOT_RELEASED' },
        streamingDraft: supported({ privateChatsOnly: true, ttlSeconds: 30 }),
      },
      contractVersion: '3.1.0',
      telegramBotApiVersion: '10.2',
    };
  }

  async automationState(query: CrmAutomationStateQueryDto, authenticatedProjectId?: string) {
    const route = await this.resolveIdentity(
      {
        crmProjectId: query.crmProjectId,
        identity: {
          channel: 'telegram',
          channelIdentityId: query.channelIdentityId,
          connectionId: query.connectionId,
        },
        omnicusContactId: query.omnicusContactId,
        omnicusProjectId: query.omnicusProjectId,
      },
      authenticatedProjectId,
    );
    const conversation = await this.database.client.conversation.findUnique({
      where: {
        projectId_connectionId_externalChatId: {
          connectionId: route.connectionId,
          externalChatId: route.externalChatId,
          projectId: route.projectId,
        },
      },
    });
    return {
      changedAt: conversation?.updatedAt?.toISOString() ?? null,
      mode: conversation?.automationModeOverride === 'DISABLED' ? 'MANUAL' : 'AUTO',
      pausedSupported: false,
      revision: conversation?.updatedAt?.toISOString() ?? 'uninitialized',
    };
  }

  async setAutomationState(dto: CrmAutomationStateDto, authenticatedProjectId?: string) {
    const route = await this.resolveIdentity(dto, authenticatedProjectId);
    const conversation = await this.database.client.conversation.upsert({
      create: {
        automationModeOverride: dto.mode === 'AUTO' ? 'ENABLED' : 'DISABLED',
        connectionId: route.connectionId,
        contactId: dto.omnicusContactId,
        externalChatId: route.externalChatId,
        projectId: route.projectId,
      },
      update: {
        automationModeOverride: dto.mode === 'AUTO' ? 'ENABLED' : 'DISABLED',
      },
      where: {
        projectId_connectionId_externalChatId: {
          connectionId: route.connectionId,
          externalChatId: route.externalChatId,
          projectId: route.projectId,
        },
      },
    });
    return {
      changedAt: conversation.updatedAt.toISOString(),
      mode: dto.mode,
      pausedSupported: false,
      revision: conversation.updatedAt.toISOString(),
    };
  }

  async chatAction(dto: CrmChatActionDto, authenticatedProjectId?: string) {
    const route = await this.resolveIdentity(dto, authenticatedProjectId);
    const actions = {
      RECORD_VIDEO_NOTE: 'record_video_note',
      RECORD_VOICE: 'record_voice',
      TYPING: 'typing',
      UPLOAD_DOCUMENT: 'upload_document',
      UPLOAD_PHOTO: 'upload_photo',
      UPLOAD_VIDEO: 'upload_video',
    } as const;
    await this.adapter.sendChatAction(this.tokenFor(route), {
      action: actions[dto.action],
      chatId: route.externalChatId,
    });
    return { accepted: true, expiresAt: new Date(Date.now() + 5_000).toISOString() };
  }

  async draft(dto: CrmDraftDto, authenticatedProjectId?: string) {
    if (!dto.text)
      return {
        accepted: false,
        expiresAt: null,
        reasonCode: 'EMPTY_DRAFT_IGNORED',
      };
    const route = await this.resolveIdentity(dto, authenticatedProjectId);
    let entities: TelegramMessageEntity[] | undefined;
    try {
      entities = dto.entities ? validateTelegramMessageEntities(dto.entities, dto.text) : undefined;
    } catch {
      throw new ConflictException({ code: 'MESSAGE_ENTITIES_INVALID' });
    }
    await this.adapter.sendMessageDraft(this.tokenFor(route), {
      chatId: route.externalChatId,
      draftId: dto.draftId,
      ...(entities ? { entities } : {}),
      text: dto.text,
    });
    return { accepted: true, expiresAt: new Date(Date.now() + 30_000).toISOString() };
  }

  async edit(
    messageId: string,
    dto: CrmMessageMutationDto,
    idempotencyKey: string,
    correlationId: string,
    authenticatedProjectId?: string,
  ) {
    if (!dto.text && dto.caption === undefined && dto.inlineKeyboard === undefined)
      throw new ConflictException({ code: 'MESSAGE_MUTATION_REQUIRED' });
    const target = await this.resolveMessage(messageId, dto, authenticatedProjectId);
    if (target.direction !== 'OUTBOUND')
      throw new ConflictException({ code: 'MESSAGE_NOT_EDITABLE' });
    const contentText = dto.text ?? dto.caption ?? '';
    let entities: TelegramMessageEntity[] | undefined;
    let inlineKeyboard;
    let linkPreviewOptions;
    try {
      entities = dto.entities
        ? validateTelegramMessageEntities(dto.entities, contentText)
        : undefined;
      inlineKeyboard = dto.inlineKeyboard
        ? validateTelegramInlineKeyboard(dto.inlineKeyboard)
        : undefined;
      linkPreviewOptions = dto.linkPreviewOptions
        ? validateTelegramLinkPreviewOptions(dto.linkPreviewOptions)
        : undefined;
    } catch {
      throw new ConflictException({ code: 'MESSAGE_MUTATION_INVALID' });
    }
    return this.queueAction(
      'EDIT_MESSAGE',
      target,
      {
        ...(dto.caption === undefined ? {} : { caption: dto.caption }),
        ...(entities ? { entities } : {}),
        ...(inlineKeyboard ? { inlineKeyboard } : {}),
        ...(linkPreviewOptions ? { linkPreviewOptions } : {}),
        ...(dto.text ? { text: dto.text } : {}),
      },
      idempotencyKey,
      correlationId,
    );
  }

  async delete(
    messageId: string,
    dto: CrmTelegramScopeDto,
    idempotencyKey: string,
    correlationId: string,
    authenticatedProjectId?: string,
  ) {
    const target = await this.resolveMessage(messageId, dto, authenticatedProjectId);
    return this.queueAction('DELETE_MESSAGE', target, {}, idempotencyKey, correlationId);
  }

  async reaction(
    messageId: string,
    dto: CrmReactionDto | CrmTelegramScopeDto,
    idempotencyKey: string,
    correlationId: string,
    authenticatedProjectId?: string,
  ) {
    const target = await this.resolveMessage(messageId, dto, authenticatedProjectId);
    const reaction: TelegramReaction | undefined =
      'type' in dto
        ? dto.type === 'emoji'
          ? { emoji: dto.value, type: 'emoji' }
          : { customEmojiId: dto.value, type: 'custom_emoji' }
        : undefined;
    return this.queueAction(
      'SET_REACTION',
      target,
      { ...('isBig' in dto && dto.isBig ? { isBig: true } : {}), reaction },
      idempotencyKey,
      correlationId,
    );
  }

  async pin(
    messageId: string,
    dto: CrmPinMessageDto,
    pinned: boolean,
    idempotencyKey: string,
    correlationId: string,
    authenticatedProjectId?: string,
  ) {
    const target = await this.resolveMessage(messageId, dto, authenticatedProjectId);
    return this.queueAction(
      'PIN_MESSAGE',
      target,
      { disableNotification: dto.disableNotification ?? false, pinned },
      idempotencyKey,
      correlationId,
    );
  }

  async retry(
    operationId: string,
    dto: CrmRetryOperationDto,
    correlationId: string,
    authenticatedProjectId?: string,
  ) {
    await this.assertProject(dto.crmProjectId, dto.omnicusProjectId, authenticatedProjectId);
    const source = await this.database.client.outboxRecord.findUnique({
      where: { projectId_id: { id: operationId, projectId: dto.omnicusProjectId } },
    });
    if (!source || source.kind !== 'TELEGRAM')
      throw new NotFoundException({ code: 'OPERATION_NOT_FOUND' });
    if (source.status === 'UNKNOWN')
      throw new ConflictException({ code: 'UNKNOWN_REQUIRES_RECONCILIATION' });
    if (source.status !== 'FAILED') throw new ConflictException({ code: 'OPERATION_NOT_FAILED' });
    if (
      !source.payload ||
      typeof source.payload !== 'object' ||
      Array.isArray(source.payload) ||
      typeof (source.payload as Prisma.JsonObject).messageId !== 'string'
    )
      throw new ConflictException({ code: 'OPERATION_PAYLOAD_INVALID' });
    const sourcePayload = source.payload as Prisma.JsonObject;
    const messageId = sourcePayload.messageId as string;
    const storedKey = `crm-retry-${dto.retryRequestId}`;
    const existing = await this.database.client.outboxRecord.findUnique({
      where: {
        projectId_idempotencyKey: {
          idempotencyKey: storedKey,
          projectId: dto.omnicusProjectId,
        },
      },
    });
    const retry =
      existing ??
      (await this.database.client.outboxRecord.create({
        data: {
          connectionId: source.connectionId,
          idempotencyKey: storedKey,
          kind: 'TELEGRAM',
          maxAttempts: source.maxAttempts,
          nextAttemptAt: new Date(),
          payload: {
            ...sourcePayload,
            retryOfOperationId: source.id,
          },
          projectId: source.projectId,
        },
      }));
    try {
      await this.outboundQueue.enqueue(retry.id);
    } catch {
      this.logger.warn({ message: 'crm_retry_enqueue_failed', operationId: retry.id });
    }
    return {
      messageId,
      operationId: retry.id,
      replayed: Boolean(existing),
      status: 'QUEUED' as const,
    };
  }

  private async queueAction(
    action: V3Action,
    target: {
      channelIdentityId: string;
      connectionId: string;
      externalMessageId: string;
      messageId: string;
      projectId: string;
    },
    mutation: Record<string, unknown>,
    idempotencyKey: string,
    correlationId: string,
  ) {
    const storedKey = `crm-v3-${idempotencyKey}`;
    let record = await this.database.client.outboxRecord.findUnique({
      where: {
        projectId_idempotencyKey: { idempotencyKey: storedKey, projectId: target.projectId },
      },
    });
    let replayed = Boolean(record);
    if (!record)
      try {
        record = await this.database.client.outboxRecord.create({
          data: {
            connectionId: target.connectionId,
            idempotencyKey: storedKey,
            kind: 'TELEGRAM',
            nextAttemptAt: new Date(),
            payload: {
              action,
              channelIdentityId: target.channelIdentityId,
              correlationId,
              messageId: target.messageId,
              mutation: mutation as Prisma.InputJsonObject,
              providerMessageId: target.externalMessageId,
            } as Prisma.InputJsonObject,
            projectId: target.projectId,
          },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'))
          throw error;
        record = await this.database.client.outboxRecord.findUnique({
          where: {
            projectId_idempotencyKey: {
              idempotencyKey: storedKey,
              projectId: target.projectId,
            },
          },
        });
        replayed = true;
      }
    if (!record) throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
    try {
      await this.outboundQueue.enqueue(record.id);
    } catch {
      this.logger.warn({ message: 'crm_v3_enqueue_failed', operationId: record.id });
    }
    return {
      messageId: target.messageId,
      operationId: record.id,
      replayed,
      status: 'QUEUED' as const,
    };
  }

  private async resolveMessage(
    messageId: string,
    dto: CrmTelegramScopeDto,
    authenticatedProjectId?: string,
  ) {
    const route = await this.resolveIdentity(dto, authenticatedProjectId);
    const message = await this.database.client.message.findFirst({
      where: {
        connectionId: dto.identity.connectionId,
        contactId: dto.omnicusContactId,
        externalMessageId: { not: null },
        id: messageId,
        projectId: dto.omnicusProjectId,
      },
    });
    if (!message?.externalMessageId) throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND' });
    return {
      channelIdentityId: dto.identity.channelIdentityId,
      connectionId: route.connectionId,
      direction: message.direction,
      externalMessageId: message.externalMessageId,
      messageId: message.id,
      projectId: message.projectId,
    };
  }

  private async resolveIdentity(dto: CrmTelegramScopeDto, authenticatedProjectId?: string) {
    await this.assertProject(dto.crmProjectId, dto.omnicusProjectId, authenticatedProjectId);
    const identity = await this.database.client.channelIdentity.findUnique({
      include: { connection: true },
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
      identity.status !== 'ACTIVE' ||
      identity.connection.type !== 'TELEGRAM' ||
      identity.connection.status !== 'ACTIVE'
    )
      throw new NotFoundException({ code: 'CHANNEL_IDENTITY_NOT_FOUND' });
    return {
      connectionId: identity.connectionId,
      credentialsEncrypted: identity.connection.credentialsEncrypted,
      externalChatId: identity.externalUserId,
      projectId: identity.connection.projectId,
    };
  }

  private tokenFor(route: {
    connectionId: string;
    credentialsEncrypted: unknown;
    projectId: string;
  }): string {
    return this.secrets.decryptSecret({
      projectId: route.projectId,
      channelConnectionId: route.connectionId,
      channelType: 'telegram',
      field: 'botToken',
      envelope: route.credentialsEncrypted as EncryptedSecretEnvelope,
    });
  }

  private async assertProject(
    crmProjectId: string,
    omnicusProjectId: string,
    authenticatedProjectId?: string,
  ) {
    const project = await this.database.client.project.findUnique({
      include: { crmConfig: true },
      where: { id: omnicusProjectId },
    });
    if (
      (authenticatedProjectId && authenticatedProjectId !== omnicusProjectId) ||
      !project ||
      project.status !== 'ACTIVE' ||
      !project.crmConfig?.enabled ||
      project.crmConfig.crmProjectId !== crmProjectId
    )
      throw new NotFoundException({ code: 'CRM_PROJECT_ROUTE_NOT_FOUND' });
  }
}
