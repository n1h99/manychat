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
import {
  normalizeTelegramUpdate,
  TELEGRAM_INBOUND_JOB_NAME,
  TELEGRAM_INBOUND_QUEUE_NAME,
} from '@omnicus/channel-telegram';
import type {
  TelegramInboundEvent,
  TelegramInboundJob,
  TelegramUpdate,
} from '@omnicus/channel-telegram';
import type { Prisma } from '@omnicus/database';
import type { WorkerEnvironment } from '@omnicus/config/server';
import { Worker, type Job } from 'bullmq';

import { DatabaseService } from '../database/database.service';
import { AutomationRuntimeService } from '../automation/automation-runtime.service';
import { redisConnectionFromUrl } from '../queue/redis-connection';
import {
  classifyTelegramInboundFailure,
  TelegramInboundLeaseConflictError,
  telegramInboundRetryDelayMilliseconds,
} from './telegram-inbound-failure';

export const TELEGRAM_INBOUND_PROCESSOR_CLIENT = Symbol('TELEGRAM_INBOUND_PROCESSOR_CLIENT');

export interface TelegramInboundProcessorClient {
  close(force?: boolean): Promise<void>;
  on(event: 'error', listener: (error: Error) => void): unknown;
  waitUntilReady(): Promise<unknown>;
}

interface ClaimedInboxRecord {
  attempts: number;
  connectionId: string;
  id: string;
  leaseToken: string;
  maxAttempts: number;
  projectId: string;
  rawWebhookEvent: {
    payload: unknown;
    receivedAt: Date;
  };
}

function contactProfile(event: TelegramInboundEvent): {
  displayName: string;
  firstName?: string;
  languageCode?: string;
  lastName?: string;
  username?: string;
} {
  const user = event.user;
  const displayName = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim();
  return {
    displayName: displayName || user?.username || event.externalUserId || 'Telegram user',
    ...(user?.first_name ? { firstName: user.first_name } : {}),
    ...(user?.language_code ? { languageCode: user.language_code } : {}),
    ...(user?.last_name ? { lastName: user.last_name } : {}),
    ...(user?.username ? { username: user.username } : {}),
  };
}

function messageTypeFor(
  event: TelegramInboundEvent,
): 'CALLBACK_QUERY' | 'COMMAND' | 'DOCUMENT' | 'PHOTO' | 'TEXT' {
  switch (event.type) {
    case 'MESSAGE':
      return 'TEXT';
    case 'COMMAND':
    case 'DOCUMENT':
    case 'PHOTO':
    case 'CALLBACK_QUERY':
      return event.type;
    default:
      throw new Error('Telegram event does not have an inbound message representation');
  }
}

@Injectable()
export class TelegramInboundProcessorService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(TelegramInboundProcessorService.name);
  private readonly workerId = `telegram-inbound:${process.pid}:${randomUUID()}`;
  private processor: TelegramInboundProcessorClient | undefined;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<WorkerEnvironment, true>,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Optional()
    @Inject(AutomationRuntimeService)
    private readonly automation?: AutomationRuntimeService,
    @Optional()
    @Inject(TELEGRAM_INBOUND_PROCESSOR_CLIENT)
    processor?: TelegramInboundProcessorClient,
  ) {
    this.processor = processor;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.processor) {
      this.processor = new Worker(
        TELEGRAM_INBOUND_QUEUE_NAME,
        async (job: Job<TelegramInboundJob, void, string>) => {
          if (job.name !== TELEGRAM_INBOUND_JOB_NAME) {
            throw new Error('Unsupported Telegram inbound job');
          }
          await this.process(job.data);
        },
        {
          concurrency: 4,
          connection: {
            ...redisConnectionFromUrl(this.config.get('REDIS_URL', { infer: true })),
            maxRetriesPerRequest: null,
          },
        },
      );
    }
    this.processor.on('error', () => {
      this.logger.error({ message: 'Telegram inbound BullMQ consumer failed' });
    });
    await this.processor.waitUntilReady();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.processor?.close();
  }

  async process(job: TelegramInboundJob): Promise<void> {
    const claimed = await this.claim(job.inboxRecordId);
    if (!claimed) return;

    try {
      const event = normalizeTelegramUpdate(claimed.rawWebhookEvent.payload as TelegramUpdate);
      await this.persist(claimed, event);
    } catch (error) {
      const failure = classifyTelegramInboundFailure(error);
      await this.markFailure(claimed, failure);
      this.logger.warn({
        errorCode: failure.code,
        inboxRecordId: claimed.id,
        message:
          failure.kind === 'PERMANENT' || claimed.attempts >= claimed.maxAttempts
            ? 'Telegram inbound processing dead-lettered an inbox record'
            : 'Telegram inbound processing scheduled an inbox retry',
        projectId: claimed.projectId,
      });
      throw error;
    }
  }

  private async claim(inboxRecordId: string): Promise<ClaimedInboxRecord | undefined> {
    const existing = await this.database.client.inboxRecord.findUnique({
      include: { rawWebhookEvent: { select: { payload: true, receivedAt: true } } },
      where: { id: inboxRecordId },
    });
    if (!existing || ['COMPLETED', 'FAILED', 'DEAD_LETTER'].includes(existing.status)) {
      return undefined;
    }

    const now = new Date();
    const leaseExpiry = new Date(
      now.getTime() - this.config.get('TELEGRAM_INBOUND_LEASE_MS', { infer: true }),
    );
    const leaseToken = `${this.workerId}:${randomUUID()}`;
    const claimed = await this.database.client.inboxRecord.updateMany({
      data: {
        attempts: { increment: 1 },
        lastError: null,
        lockedAt: now,
        lockedBy: leaseToken,
        status: 'PROCESSING',
      },
      where: {
        id: existing.id,
        projectId: existing.projectId,
        OR: [
          { nextAttemptAt: { lte: now }, status: { in: ['PENDING', 'RETRY'] } },
          { lockedAt: null, status: 'PROCESSING' },
          { lockedAt: { lt: leaseExpiry }, status: 'PROCESSING' },
        ],
      },
    });
    if (claimed.count !== 1) return undefined;

    return {
      attempts: existing.attempts + 1,
      connectionId: existing.connectionId,
      id: existing.id,
      leaseToken,
      maxAttempts: existing.maxAttempts,
      projectId: existing.projectId,
      rawWebhookEvent: existing.rawWebhookEvent,
    };
  }

  private async persist(claimed: ClaimedInboxRecord, event: TelegramInboundEvent): Promise<void> {
    const eventAt = claimed.rawWebhookEvent.receivedAt;
    await this.database.client.$transaction(async (transaction) => {
      const normalized = await transaction.normalizedEvent.upsert({
        create: {
          connectionId: claimed.connectionId,
          inboxRecordId: claimed.id,
          payload: {
            content: event.content,
            metadata: event.metadata,
          } as Prisma.InputJsonValue,
          projectId: claimed.projectId,
          type: event.type,
        },
        update: {},
        where: {
          projectId_inboxRecordId: { inboxRecordId: claimed.id, projectId: claimed.projectId },
        },
      });

      const contact = event.externalUserId
        ? await this.resolveContact(transaction, claimed, event, eventAt)
        : undefined;

      let conversationId: string | undefined;
      if (
        contact &&
        event.chatId &&
        ['MESSAGE', 'COMMAND', 'PHOTO', 'DOCUMENT', 'CALLBACK_QUERY'].includes(event.type)
      ) {
        const conversation = await transaction.conversation.upsert({
          create: {
            connectionId: claimed.connectionId,
            contactId: contact.id,
            externalChatId: event.chatId,
            projectId: claimed.projectId,
          },
          update: {
            lastMessageAt: eventAt,
          },
          where: {
            projectId_connectionId_externalChatId: {
              connectionId: claimed.connectionId,
              externalChatId: event.chatId,
              projectId: claimed.projectId,
            },
          },
        });
        conversationId = conversation.id;
        const message = await transaction.message.upsert({
          create: {
            connectionId: claimed.connectionId,
            contactId: contact.id,
            content: event.content as Prisma.InputJsonValue,
            conversationId: conversation.id,
            direction: 'INBOUND',
            externalMessageId: event.externalMessageId ?? `event:${claimed.id}`,
            metadata: event.metadata as Prisma.InputJsonValue,
            normalizedEventId: normalized.id,
            projectId: claimed.projectId,
            status: 'RECEIVED',
            type: messageTypeFor(event),
          },
          update: {},
          where: {
            projectId_normalizedEventId: {
              normalizedEventId: normalized.id,
              projectId: claimed.projectId,
            },
          },
        });
        if (event.type === 'PHOTO' || event.type === 'DOCUMENT') {
          const providerMediaId =
            typeof event.content.fileId === 'string' ? event.content.fileId : undefined;
          if (providerMediaId) {
            const mediaAsset = await transaction.mediaAsset.upsert({
              create: {
                connectionId: claimed.connectionId,
                declaredMimeType:
                  typeof event.content.mimeType === 'string' ? event.content.mimeType : null,
                kind: event.type,
                originalFilename:
                  typeof event.content.fileName === 'string' ? event.content.fileName : null,
                projectId: claimed.projectId,
                providerMediaId,
                providerMediaUniqueId:
                  typeof event.content.fileUniqueId === 'string'
                    ? event.content.fileUniqueId
                    : null,
                providerMetadata: event.content as Prisma.InputJsonValue,
                sizeBytes:
                  typeof event.content.fileSize === 'number'
                    ? BigInt(event.content.fileSize)
                    : null,
                source: 'TELEGRAM',
                status: 'PROVIDER_REFERENCE',
              },
              update: {
                providerMetadata: event.content as Prisma.InputJsonValue,
              },
              where: {
                projectId_connectionId_providerMediaId: {
                  connectionId: claimed.connectionId,
                  projectId: claimed.projectId,
                  providerMediaId,
                },
              },
            });
            await transaction.message.update({
              data: { mediaAssetId: mediaAsset.id },
              where: { projectId_id: { id: message.id, projectId: claimed.projectId } },
            });
          }
        }
      }

      if (contact && conversationId) {
        await this.automation?.resolveWaitsInTransaction(transaction, {
          connectionId: claimed.connectionId,
          contactId: contact.id,
          conversationId,
          normalizedEventId: normalized.id,
          projectId: claimed.projectId,
        });
        await this.automation?.triggerInTransaction(transaction, {
          connectionId: claimed.connectionId,
          contactId: contact.id,
          conversationId,
          normalizedEventId: normalized.id,
          projectId: claimed.projectId,
        });
      }

      const completed = await transaction.inboxRecord.updateMany({
        data: {
          completedAt: new Date(),
          lastError: null,
          lockedAt: null,
          lockedBy: null,
          status: 'COMPLETED',
        },
        where: {
          id: claimed.id,
          lockedBy: claimed.leaseToken,
          projectId: claimed.projectId,
          status: 'PROCESSING',
        },
      });
      if (completed.count !== 1) throw new TelegramInboundLeaseConflictError();
    });
  }

  private async resolveContact(
    transaction: Prisma.TransactionClient,
    claimed: ClaimedInboxRecord,
    event: TelegramInboundEvent,
    eventAt: Date,
  ): Promise<{ id: string }> {
    const externalUserId = event.externalUserId;
    if (!externalUserId) throw new Error('Telegram identity subject is missing');
    const profile = contactProfile(event);
    const identity = await transaction.channelIdentity.findUnique({
      select: { contactId: true },
      where: {
        projectId_connectionId_externalUserId: {
          connectionId: claimed.connectionId,
          externalUserId,
          projectId: claimed.projectId,
        },
      },
    });

    if (!identity) {
      const contact = await transaction.contact.create({
        data: {
          displayName: profile.displayName,
          firstInteractionAt: eventAt,
          ...(profile.firstName ? { firstName: profile.firstName } : {}),
          ...(profile.lastName ? { lastName: profile.lastName } : {}),
          lastInteractionAt: eventAt,
          ...(profile.username ? { username: profile.username } : {}),
          projectId: claimed.projectId,
        },
        select: { id: true },
      });
      await transaction.channelIdentity.create({
        data: {
          channel: 'TELEGRAM',
          connectionId: claimed.connectionId,
          contactId: contact.id,
          displayName: profile.displayName,
          externalUserId,
          ...(profile.languageCode ? { languageCode: profile.languageCode } : {}),
          metadata: { source: 'telegram_inbound' },
          projectId: claimed.projectId,
          status: event.identityStatus ?? 'ACTIVE',
          ...(profile.username ? { username: profile.username } : {}),
        },
      });
      return contact;
    }

    await transaction.contact.update({
      data: {
        displayName: profile.displayName,
        ...(profile.firstName ? { firstName: profile.firstName } : {}),
        ...(profile.lastName ? { lastName: profile.lastName } : {}),
        ...(profile.username ? { username: profile.username } : {}),
      },
      where: { projectId_id: { id: identity.contactId, projectId: claimed.projectId } },
    });
    await transaction.contact.updateMany({
      data: { lastInteractionAt: eventAt },
      where: {
        id: identity.contactId,
        projectId: claimed.projectId,
        OR: [{ lastInteractionAt: null }, { lastInteractionAt: { lt: eventAt } }],
      },
    });
    await transaction.channelIdentity.update({
      data: {
        displayName: profile.displayName,
        ...(profile.languageCode ? { languageCode: profile.languageCode } : {}),
        status: event.identityStatus ?? 'ACTIVE',
        ...(profile.username ? { username: profile.username } : {}),
      },
      where: {
        projectId_connectionId_externalUserId: {
          connectionId: claimed.connectionId,
          externalUserId,
          projectId: claimed.projectId,
        },
      },
    });
    return { id: identity.contactId };
  }

  private async markFailure(
    claimed: ClaimedInboxRecord,
    failure: ReturnType<typeof classifyTelegramInboundFailure>,
  ): Promise<void> {
    const shouldDeadLetter =
      failure.kind === 'PERMANENT' || claimed.attempts >= claimed.maxAttempts;
    await this.database.client.inboxRecord.updateMany({
      data: {
        lastError: failure.code,
        lockedAt: null,
        lockedBy: null,
        ...(shouldDeadLetter
          ? { nextAttemptAt: null, status: 'DEAD_LETTER' as const }
          : {
              nextAttemptAt: new Date(
                Date.now() + telegramInboundRetryDelayMilliseconds(claimed.attempts),
              ),
              status: 'RETRY' as const,
            }),
      },
      where: {
        id: claimed.id,
        lockedBy: claimed.leaseToken,
        projectId: claimed.projectId,
        status: 'PROCESSING',
      },
    });
  }
}
