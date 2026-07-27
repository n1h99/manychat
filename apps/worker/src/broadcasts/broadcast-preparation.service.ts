import { randomUUID } from 'node:crypto';

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Prisma } from '@omnicus/database';
import {
  TELEGRAM_OUTBOUND_JOB_NAME,
  TELEGRAM_OUTBOUND_QUEUE_NAME,
  telegramOutboundJobIdFor,
  type TelegramOutboundJob,
} from '@omnicus/channel-telegram';
import type { WorkerEnvironment } from '@omnicus/config/server';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { DatabaseService } from '../database/database.service';
import { redisConnectionFromUrl } from '../queue/redis-connection';

type Audience = {
  mode: 'ALL_ACTIVE' | 'SEGMENT' | 'CONTACTS';
  segmentId?: string;
  contactIds?: string[];
  includeTagIds?: string[];
  excludeTagIds?: string[];
};

@Injectable()
export class BroadcastPreparationService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BroadcastPreparationService.name);
  private readonly workerId = `broadcast-preparation-${process.pid}-${randomUUID()}`;
  private readonly queue: Queue<TelegramOutboundJob>;
  private timer: NodeJS.Timeout | undefined;
  private scanning = false;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<WorkerEnvironment, true>,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {
    this.queue = new Queue(TELEGRAM_OUTBOUND_QUEUE_NAME, {
      connection: redisConnectionFromUrl(config.get('REDIS_URL', { infer: true })),
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.waitUntilReady();
    this.timer = setInterval(() => void this.runScheduledScan(), 5_000);
    this.timer.unref();
    void this.runScheduledScan();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.queue.close();
  }

  async scanOnce(now = new Date()): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      await this.database.client.broadcast.updateMany({
        where: { status: 'SCHEDULED', scheduledAt: { lte: now } },
        data: { status: 'PREPARING', startedAt: now, scheduledAt: null },
      });
      const expired = new Date(now.getTime() - 60_000);
      const candidates = await this.database.client.broadcast.findMany({
        where: {
          status: 'PREPARING',
          OR: [{ preparationLockedAt: null }, { preparationLockedAt: { lt: expired } }],
        },
        orderBy: { startedAt: 'asc' },
        take: 20,
      });
      for (const candidate of candidates) {
        const lease = `${this.workerId}-${randomUUID()}`;
        const claimed = await this.database.client.broadcast.updateMany({
          where: {
            id: candidate.id,
            projectId: candidate.projectId,
            status: 'PREPARING',
            OR: [{ preparationLockedAt: null }, { preparationLockedAt: { lt: expired } }],
          },
          data: { preparationLockedAt: now, preparationLockedBy: lease },
        });
        if (claimed.count) await this.materialize(candidate.id, candidate.projectId, lease);
      }
    } finally {
      this.scanning = false;
    }
  }

  private async runScheduledScan(): Promise<void> {
    try {
      await this.scanOnce();
    } catch {
      // Dependency readiness is exposed by the worker health endpoint. A
      // transient database outage must not turn a recoverable polling failure
      // into a process-level crash.
      this.logger.warn({ message: 'broadcast_preparation_scan_failed' });
    }
  }

  private async materialize(broadcastId: string, projectId: string, lease: string): Promise<void> {
    try {
      const broadcast = await this.database.client.broadcast.findUnique({
        where: { projectId_id: { id: broadcastId, projectId } },
      });
      if (!broadcast || broadcast.status !== 'PREPARING' || broadcast.preparationLockedBy !== lease)
        return;
      const identities = await this.identities(
        projectId,
        broadcast.connectionId,
        broadcast.audience as unknown as Audience,
      );
      await this.database.client.$transaction(async (tx) => {
        const active = await tx.channelConnection.findUnique({
          where: { projectId_id: { id: broadcast.connectionId, projectId } },
          select: { status: true, type: true },
        });
        if (!active || active.status !== 'ACTIVE' || active.type !== 'TELEGRAM') {
          await tx.broadcast.updateMany({
            where: { id: broadcastId, projectId, preparationLockedBy: lease, status: 'PREPARING' },
            data: {
              status: 'FAILED',
              failedAt: new Date(),
              errorCode: 'broadcast_channel_not_active',
              preparationLockedAt: null,
              preparationLockedBy: null,
            },
          });
          return;
        }
        await tx.broadcastRecipient.createMany({
          data: identities.map((identity) => ({
            projectId,
            broadcastId,
            connectionId: broadcast.connectionId,
            contactId: identity.contactId,
            channelIdentityId: identity.id,
            eligibility: { snapshot: 'eligible' },
          })),
          skipDuplicates: true,
        });
        await tx.broadcast.updateMany({
          where: { id: broadcastId, projectId, preparationLockedBy: lease, status: 'PREPARING' },
          data: {
            status: identities.length ? 'RUNNING' : 'COMPLETED',
            completedAt: identities.length ? null : new Date(),
            preparationLockedAt: null,
            preparationLockedBy: null,
            errorCode: null,
          },
        });
      });
      const pending = await this.database.client.broadcastRecipient.findMany({
        where: { projectId, broadcastId, status: 'PENDING' },
        select: { id: true, contactId: true, channelIdentityId: true },
      });
      const identityById = new Map(identities.map((identity) => [identity.id, identity]));
      for (const recipient of pending) {
        const identity = identityById.get(recipient.channelIdentityId);
        if (!identity) continue;
        const outboxId = await this.database.client.$transaction(async (tx) => {
          const current = await tx.broadcast.findUnique({
            where: { projectId_id: { id: broadcastId, projectId } },
          });
          if (!current || current.status !== 'RUNNING') return undefined;
          const conversation = await tx.conversation.upsert({
            where: {
              projectId_connectionId_externalChatId: {
                projectId,
                connectionId: broadcast.connectionId,
                externalChatId: identity.externalUserId,
              },
            },
            create: {
              projectId,
              connectionId: broadcast.connectionId,
              contactId: recipient.contactId,
              externalChatId: identity.externalUserId,
              status: 'ACTIVE',
            },
            update: {},
          });
          const message = await tx.message.create({
            data: {
              projectId,
              connectionId: broadcast.connectionId,
              contactId: recipient.contactId,
              conversationId: conversation.id,
              direction: 'OUTBOUND',
              type: 'TEXT',
              status: 'QUEUED',
              content: current.content as Prisma.InputJsonValue,
              metadata: { broadcastId, broadcastRecipientId: recipient.id },
            },
          });
          const outbox = await tx.outboxRecord.create({
            data: {
              projectId,
              connectionId: broadcast.connectionId,
              kind: 'TELEGRAM',
              idempotencyKey: `broadcast-recipient-${recipient.id}`,
              payload: { messageId: message.id, channelIdentityId: recipient.channelIdentityId },
            },
          });
          const linked = await tx.broadcastRecipient.updateMany({
            where: { id: recipient.id, projectId, status: 'PENDING' },
            data: {
              status: 'QUEUED',
              messageId: message.id,
              outboxRecordId: outbox.id,
              queuedAt: new Date(),
            },
          });
          return linked.count ? outbox.id : undefined;
        });
        if (outboxId) await this.enqueue(outboxId);
      }
    } catch {
      await this.database.client.broadcast.updateMany({
        where: { id: broadcastId, projectId, status: 'PREPARING', preparationLockedBy: lease },
        data: {
          errorCode: 'broadcast_preparation_retryable',
          preparationLockedAt: null,
          preparationLockedBy: null,
        },
      });
      this.logger.warn({ broadcastId, message: 'Broadcast preparation deferred' });
    }
  }

  private async enqueue(outboxRecordId: string): Promise<void> {
    try {
      await this.queue.add(
        TELEGRAM_OUTBOUND_JOB_NAME,
        { outboxRecordId },
        {
          attempts: 8,
          backoff: { delay: 1_000, type: 'exponential' },
          jobId: telegramOutboundJobIdFor(outboxRecordId),
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch {
      this.logger.warn({ outboxRecordId, message: 'Broadcast outbound enqueue deferred' });
    }
  }

  private async identities(projectId: string, connectionId: string, audience: Audience) {
    const contact: Prisma.ContactWhereInput = { projectId, status: 'ACTIVE' };
    if (audience.mode === 'CONTACTS') contact.id = { in: audience.contactIds ?? [] };
    if (audience.mode === 'SEGMENT') {
      const segment = await this.database.client.segment.findFirst({
        where: {
          id: audience.segmentId ?? '__missing__',
          projectId,
          status: 'ACTIVE',
          archivedAt: null,
        },
      });
      if (!segment) return [];
      Object.assign(contact, await this.segmentWhere(projectId, segment.filter));
    }
    const tags: Prisma.ContactWhereInput[] = [];
    for (const tagId of audience.includeTagIds ?? [])
      tags.push({ tags: { some: { projectId, tagId } } });
    if (audience.excludeTagIds?.length)
      tags.push({ tags: { none: { projectId, tagId: { in: audience.excludeTagIds } } } });
    if (tags.length) contact.AND = tags;
    return this.database.client.channelIdentity.findMany({
      where: {
        projectId,
        connectionId,
        channel: 'TELEGRAM',
        status: 'ACTIVE',
        contact: { is: contact },
      },
      select: { id: true, contactId: true, externalUserId: true },
    });
  }

  private async segmentWhere(
    projectId: string,
    value: Prisma.JsonValue,
  ): Promise<Prisma.ContactWhereInput> {
    const filter =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, Prisma.JsonValue>)
        : {};
    const where: Prisma.ContactWhereInput = {
      ...(typeof filter.status === 'string' ? { status: filter.status as never } : {}),
      ...(typeof filter.channel === 'string'
        ? { channelIdentities: { some: { channel: filter.channel as never } } }
        : {}),
      ...(typeof filter.tagId === 'string' ? { tags: { some: { tagId: filter.tagId } } } : {}),
      ...(typeof filter.hasCrmLeadId === 'boolean'
        ? { crmLeadId: filter.hasCrmLeadId ? { not: null } : null }
        : {}),
    };
    if (typeof filter.customFieldKey === 'string') {
      const definition = await this.database.client.customFieldDefinition.findFirst({
        where: { archivedAt: null, key: filter.customFieldKey, projectId },
      });
      if (!definition) return { id: '__missing_segment_definition__' };
      const customValue = filter.customFieldValue;
      where.customFieldValues = {
        some: {
          projectId,
          definitionId: definition.id,
          ...(typeof customValue === 'number'
            ? { valueNumber: customValue }
            : typeof customValue === 'boolean'
              ? { valueBoolean: customValue }
              : { valueText: String(customValue) }),
        },
      };
    }
    return where;
  }
}
