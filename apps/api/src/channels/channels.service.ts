import { randomBytes } from 'node:crypto';

import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ChannelSecretsService, maskTelegramToken } from '@omnicus/channel-secrets';
import type { EncryptedSecretEnvelope } from '@omnicus/channel-secrets';
import { TelegramAdapter, TelegramHttpTransport } from '@omnicus/channel-telegram';
import type { Prisma } from '@omnicus/database';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@omnicus/config/server';

import type { RequestSecurityContext } from '../auth/auth.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import type {
  CreateTelegramChannelDto,
  TestTelegramMessageDto,
  UpdateTelegramChannelDto,
} from './dto';
import { TelegramOutboundQueueService } from './telegram-outbound-queue.service';

type ChannelMetadata = {
  name?: string;
  maskedToken?: string;
  webhookStatus?: 'CONNECTED' | 'NOT_CONNECTED';
  webhookUrl?: string;
};
type SafeChannel = {
  id: string;
  projectId: string;
  type: 'TELEGRAM';
  name: string;
  status: string;
  botUsername: string | null;
  externalBotId: string | null;
  maskedToken: string | null;
  webhookStatus: string;
  lastWebhookAt: Date | null;
  lastErrorAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);
  private readonly secrets: ChannelSecretsService;
  private readonly telegram = new TelegramAdapter(new TelegramHttpTransport());
  private readonly apiPublicUrl: string;
  constructor(
    @Inject(ConfigService) config: ConfigService<ApiEnvironment, true>,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TelegramOutboundQueueService) private readonly outbound: TelegramOutboundQueueService,
  ) {
    this.secrets = new ChannelSecretsService(config.get('CHANNEL_SECRETS_KEY', { infer: true }));
    this.apiPublicUrl = config.get('API_PUBLIC_URL', { infer: true });
  }

  async list(projectId: string): Promise<SafeChannel[]> {
    const rows = await this.database.client.channelConnection.findMany({
      where: { projectId, type: 'TELEGRAM' },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.safe(row));
  }
  async get(projectId: string, connectionId: string): Promise<SafeChannel> {
    return this.safe(await this.connection(projectId, connectionId));
  }
  async inboundEvents(projectId: string, connectionId: string) {
    await this.connection(projectId, connectionId);
    return this.database.client.rawWebhookEvent.findMany({
      orderBy: { receivedAt: 'desc' },
      select: {
        correlationId: true,
        externalUpdateId: true,
        inboxRecord: {
          select: {
            attempts: true,
            completedAt: true,
            lastError: true,
            maxAttempts: true,
            nextAttemptAt: true,
            normalizedEvent: {
              select: {
                createdAt: true,
                message: {
                  select: {
                    contactId: true,
                    conversationId: true,
                    id: true,
                    status: true,
                  },
                },
                type: true,
              },
            },
            status: true,
          },
        },
        receivedAt: true,
        status: true,
      },
      take: 20,
      where: { connectionId, projectId },
    });
  }
  async create(
    projectId: string,
    dto: CreateTelegramChannelDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ): Promise<SafeChannel> {
    const id = crypto.randomUUID();
    let bot: { id: string; username?: string };
    try {
      bot = await this.telegram.validateConnection(dto.botToken);
    } catch {
      throw new BadRequestException({
        code: 'TELEGRAM_TOKEN_INVALID',
        message: 'Telegram connection validation failed',
      });
    }
    const secret = randomBytes(32).toString('base64url');
    const row = await this.database.client.channelConnection.create({
      data: {
        id,
        projectId,
        type: 'TELEGRAM',
        status: 'DRAFT',
        credentialsEncrypted: this.encrypt(
          projectId,
          id,
          'botToken',
          dto.botToken,
        ) as unknown as Prisma.InputJsonValue,
        webhookSecretEncrypted: this.encrypt(
          projectId,
          id,
          'webhookSecret',
          secret,
        ) as unknown as Prisma.InputJsonValue,
        botUsername: bot.username ?? null,
        externalBotId: bot.id,
        webhookMetadata: {
          name: dto.name,
          maskedToken: maskTelegramToken(dto.botToken),
          webhookStatus: 'NOT_CONNECTED',
        },
      },
    });
    await this.audit.record({
      action: 'channel.create',
      actorUserId: actor.userId,
      correlationId: context.correlationId,
      entityId: row.id,
      entityType: 'ChannelConnection',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
      afterSafeJson: { status: row.status, type: 'TELEGRAM' },
    });
    return this.safe(row);
  }
  async update(
    projectId: string,
    connectionId: string,
    dto: UpdateTelegramChannelDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ): Promise<SafeChannel> {
    const previous = await this.connection(projectId, connectionId);
    const metadata = this.metadata(previous.webhookMetadata);
    let data: Prisma.ChannelConnectionUpdateInput = {
      webhookMetadata: { ...metadata, ...(dto.name ? { name: dto.name } : {}) },
    };
    if (dto.botToken !== undefined) {
      let bot: { id: string; username?: string };
      try {
        bot = await this.telegram.validateConnection(dto.botToken);
      } catch {
        throw new BadRequestException({
          code: 'TELEGRAM_TOKEN_INVALID',
          message: 'Telegram connection validation failed',
        });
      }
      data = {
        ...data,
        botUsername: bot.username ?? null,
        credentialsEncrypted: this.encrypt(
          projectId,
          connectionId,
          'botToken',
          dto.botToken,
        ) as unknown as Prisma.InputJsonValue,
        externalBotId: bot.id,
        webhookMetadata: {
          ...metadata,
          ...(dto.name ? { name: dto.name } : {}),
          maskedToken: maskTelegramToken(dto.botToken),
        },
      };
    }
    const row = await this.database.client.channelConnection.update({
      where: { projectId_id: { projectId, id: connectionId } },
      data,
    });
    await this.audit.record({
      action: dto.botToken ? 'channel.token.replace' : 'channel.update',
      actorUserId: actor.userId,
      correlationId: context.correlationId,
      entityId: connectionId,
      entityType: 'ChannelConnection',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
      afterSafeJson: { tokenReplaced: dto.botToken !== undefined },
    });
    return this.safe(row);
  }
  async test(
    projectId: string,
    id: string,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ): Promise<SafeChannel> {
    const row = await this.connection(projectId, id);
    try {
      await this.telegram.validateConnection(this.decrypt(row, 'botToken'));
      const updated = await this.database.client.channelConnection.update({
        where: { id },
        data: { lastErrorAt: null },
      });
      await this.audit.record({
        action: 'channel.test',
        actorUserId: actor.userId,
        correlationId: context.correlationId,
        entityId: id,
        entityType: 'ChannelConnection',
        ip: context.ip,
        projectId,
        userAgent: context.userAgent,
      });
      return this.safe(updated);
    } catch {
      await this.database.client.channelConnection.update({
        where: { id },
        data: { lastErrorAt: new Date(), status: 'ERROR' },
      });
      throw new BadRequestException({
        code: 'TELEGRAM_CONNECTION_TEST_FAILED',
        message: 'Telegram connection test failed',
      });
    }
  }
  async connect(
    projectId: string,
    id: string,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ): Promise<SafeChannel> {
    const row = await this.connection(projectId, id);
    const url = this.webhookUrl(id);
    try {
      await this.telegram.configureWebhook(this.decrypt(row, 'botToken'), {
        secretToken: this.decrypt(row, 'webhookSecret'),
        url,
      });
    } catch {
      await this.database.client.channelConnection.update({
        where: { id },
        data: { lastErrorAt: new Date(), status: 'ERROR' },
      });
      throw new BadRequestException({
        code: 'TELEGRAM_WEBHOOK_CONNECT_FAILED',
        message: 'Telegram webhook connection failed',
      });
    }
    const metadata = this.metadata(row.webhookMetadata);
    const updated = await this.database.client.channelConnection.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        lastErrorAt: null,
        webhookMetadata: { ...metadata, webhookStatus: 'CONNECTED', webhookUrl: url },
      },
    });
    await this.audit.record({
      action: 'channel.webhook.connect',
      actorUserId: actor.userId,
      correlationId: context.correlationId,
      entityId: id,
      entityType: 'ChannelConnection',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
    return this.safe(updated);
  }
  async disable(
    projectId: string,
    id: string,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ): Promise<SafeChannel> {
    const row = await this.connection(projectId, id);
    if (row.status !== 'DISABLED') {
      try {
        await this.telegram.removeWebhook(this.decrypt(row, 'botToken'));
      } catch {
        this.logger.warn({ connectionId: id, message: 'Telegram webhook removal failed' });
      }
    }
    const metadata = this.metadata(row.webhookMetadata);
    const updated = await this.database.client.channelConnection.update({
      where: { id },
      data: {
        status: 'DISABLED',
        webhookMetadata: { ...metadata, webhookStatus: 'NOT_CONNECTED' },
      },
    });
    await this.audit.record({
      action: 'channel.disable',
      actorUserId: actor.userId,
      correlationId: context.correlationId,
      entityId: id,
      entityType: 'ChannelConnection',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
    return this.safe(updated);
  }
  async rotateSecret(
    projectId: string,
    id: string,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ): Promise<SafeChannel> {
    const row = await this.connection(projectId, id);
    const next = randomBytes(32).toString('base64url');
    const url = this.metadata(row.webhookMetadata).webhookUrl;
    if (!url)
      throw new BadRequestException({
        code: 'WEBHOOK_NOT_CONNECTED',
        message: 'Webhook is not connected',
      });
    try {
      await this.telegram.configureWebhook(this.decrypt(row, 'botToken'), {
        secretToken: next,
        url,
      });
    } catch {
      throw new BadRequestException({
        code: 'TELEGRAM_WEBHOOK_ROTATE_FAILED',
        message: 'Telegram webhook secret rotation failed',
      });
    }
    const updated = await this.database.client.channelConnection.update({
      where: { id },
      data: {
        webhookSecretEncrypted: this.encrypt(
          projectId,
          id,
          'webhookSecret',
          next,
        ) as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.record({
      action: 'channel.webhook_secret.rotate',
      actorUserId: actor.userId,
      correlationId: context.correlationId,
      entityId: id,
      entityType: 'ChannelConnection',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
    return this.safe(updated);
  }
  async createTestMessage(
    projectId: string,
    connectionId: string,
    dto: TestTelegramMessageDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ): Promise<{ messageId: string; outboxRecordId: string }> {
    if ((dto.contactId === undefined) === (dto.channelIdentityId === undefined))
      throw new BadRequestException({
        code: 'OUTBOUND_RECIPIENT_REQUIRED',
        message: 'Provide exactly one recipient',
      });
    const connection = await this.connection(projectId, connectionId);
    if (connection.status !== 'ACTIVE')
      throw new BadRequestException({
        code: 'CHANNEL_NOT_ACTIVE',
        message: 'Channel is not active',
      });
    const identity = await this.database.client.channelIdentity.findFirst({
      where: {
        projectId,
        connectionId,
        ...(dto.channelIdentityId ? { id: dto.channelIdentityId } : { contactId: dto.contactId! }),
      },
    });
    if (!identity)
      throw new NotFoundException({
        code: 'CHANNEL_IDENTITY_NOT_FOUND',
        message: 'Recipient was not found',
      });
    const existing = await this.database.client.outboxRecord.findUnique({
      where: { projectId_idempotencyKey: { projectId, idempotencyKey: dto.idempotencyKey } },
    });
    if (existing)
      return {
        messageId: String((existing.payload as { messageId?: string }).messageId),
        outboxRecordId: existing.id,
      };
    const result = await this.database.client.$transaction(async (tx) => {
      const conversation = await tx.conversation.upsert({
        where: {
          projectId_connectionId_externalChatId: {
            projectId,
            connectionId,
            externalChatId: identity.externalUserId,
          },
        },
        create: {
          projectId,
          connectionId,
          contactId: identity.contactId,
          externalChatId: identity.externalUserId,
          status: 'ACTIVE',
        },
        update: {},
      });
      const message = await tx.message.create({
        data: {
          projectId,
          connectionId,
          contactId: identity.contactId,
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          type: 'TEXT',
          status: 'QUEUED',
          content: { text: dto.text },
          metadata: {
            disableNotification: dto.disableNotification ?? false,
            replyToMessageId: dto.replyToMessageId ?? null,
          },
        },
      });
      const outbox = await tx.outboxRecord.create({
        data: {
          projectId,
          connectionId,
          idempotencyKey: dto.idempotencyKey,
          payload: { messageId: message.id, channelIdentityId: identity.id },
        },
      });
      await tx.idempotencyRecord.upsert({
        where: {
          projectId_scope_key: { projectId, scope: 'telegram-outbound', key: dto.idempotencyKey },
        },
        create: { projectId, scope: 'telegram-outbound', key: dto.idempotencyKey },
        update: {},
      });
      return { messageId: message.id, outboxRecordId: outbox.id };
    });
    try {
      await this.outbound.enqueue(result.outboxRecordId);
    } catch {
      this.logger.warn({
        message: 'Telegram outbound enqueue failed',
        outboxRecordId: result.outboxRecordId,
      });
    }
    await this.audit.record({
      action: 'channel.test_message.request',
      actorUserId: actor.userId,
      correlationId: context.correlationId,
      entityId: result.outboxRecordId,
      entityType: 'OutboxRecord',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
      afterSafeJson: { connectionId },
    });
    return result;
  }
  async identities(projectId: string, connectionId: string) {
    await this.connection(projectId, connectionId);
    return this.database.client.channelIdentity.findMany({
      orderBy: [{ contact: { displayName: 'asc' } }, { createdAt: 'asc' }],
      select: {
        contact: {
          select: {
            displayName: true,
            id: true,
          },
        },
        displayName: true,
        externalUserId: true,
        id: true,
        status: true,
        username: true,
      },
      where: {
        channel: 'TELEGRAM',
        connectionId,
        projectId,
      },
    });
  }
  private async connection(projectId: string, id: string) {
    const row = await this.database.client.channelConnection.findUnique({
      where: { projectId_id: { projectId, id } },
    });
    if (!row || row.type !== 'TELEGRAM')
      throw new NotFoundException({ code: 'CHANNEL_NOT_FOUND', message: 'Channel was not found' });
    return row;
  }
  private encrypt(
    projectId: string,
    connectionId: string,
    field: string,
    plaintext: string,
  ): EncryptedSecretEnvelope {
    return this.secrets.encryptSecret({
      projectId,
      channelConnectionId: connectionId,
      channelType: 'telegram',
      field,
      plaintext,
    });
  }
  private decrypt(
    row: {
      id: string;
      projectId: string;
      credentialsEncrypted: Prisma.JsonValue;
      webhookSecretEncrypted: Prisma.JsonValue;
    },
    field: 'botToken' | 'webhookSecret',
  ): string {
    const envelope = (field === 'botToken'
      ? row.credentialsEncrypted
      : row.webhookSecretEncrypted) as unknown as EncryptedSecretEnvelope;
    return this.secrets.decryptSecret({
      projectId: row.projectId,
      channelConnectionId: row.id,
      channelType: 'telegram',
      field,
      envelope,
    });
  }
  private metadata(value: Prisma.JsonValue | null): ChannelMetadata {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as ChannelMetadata)
      : {};
  }
  private safe(row: {
    id: string;
    projectId: string;
    type: string;
    status: string;
    botUsername: string | null;
    externalBotId: string | null;
    webhookMetadata: Prisma.JsonValue | null;
    lastWebhookAt: Date | null;
    lastErrorAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): SafeChannel {
    const m = this.metadata(row.webhookMetadata);
    return {
      id: row.id,
      projectId: row.projectId,
      type: 'TELEGRAM',
      name: m.name ?? 'Telegram',
      status: row.status,
      botUsername: row.botUsername,
      externalBotId: row.externalBotId,
      maskedToken: m.maskedToken ?? null,
      webhookStatus: m.webhookStatus ?? 'NOT_CONNECTED',
      lastWebhookAt: row.lastWebhookAt,
      lastErrorAt: row.lastErrorAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
  private webhookUrl(id: string): string {
    return `${this.apiPublicUrl}/webhooks/telegram/${id}`;
  }
}
