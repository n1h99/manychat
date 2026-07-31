import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@omnicus/database';
import { renderMessageTemplateContent } from '@omnicus/media-core';

import { AuditService } from '../audit/audit.service';
import type { RequestSecurityContext } from '../auth/auth.service';
import { TelegramOutboundQueueService } from '../channels/telegram-outbound-queue.service';
import { DatabaseService } from '../database/database.service';
import type {
  BroadcastAudienceDto,
  BroadcastRecipientsQueryDto,
  CreateBroadcastDto,
  UpdateBroadcastDto,
} from './dto';

type AuditContext = RequestSecurityContext & { actorUserId: string; actorEmail: string };
type Audience = BroadcastAudienceDto;

@Injectable()
export class BroadcastsService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(TelegramOutboundQueueService) private readonly outbound: TelegramOutboundQueueService,
  ) {}

  async list(projectId: string, archived = false) {
    const broadcasts = await this.database.client.broadcast.findMany({
      where: { projectId, status: archived ? 'ARCHIVED' : { not: 'ARCHIVED' } },
      orderBy: { createdAt: 'desc' },
      include: {
        connection: { select: { botUsername: true } },
        _count: { select: { recipients: true } },
      },
    });
    return broadcasts.map((broadcast) => this.safe(broadcast));
  }

  async get(projectId: string, broadcastId: string) {
    const broadcast = await this.broadcast(projectId, broadcastId, {
      connection: { select: { botUsername: true } },
      _count: { select: { recipients: true } },
    });
    const grouped = await this.database.client.broadcastRecipient.groupBy({
      by: ['status'],
      where: { broadcastId, projectId },
      _count: { _all: true },
    });
    return {
      ...this.safe(broadcast),
      recipientsByStatus: Object.fromEntries(grouped.map((row) => [row.status, row._count._all])),
    };
  }

  async create(projectId: string, dto: CreateBroadcastDto, context: AuditContext) {
    this.assertAudience(dto.audience);
    await this.assertConnection(projectId, dto.connectionId);
    const templateVersion = dto.templateVersionId
      ? await this.templateVersion(projectId, dto.templateVersionId)
      : undefined;
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    if (scheduledAt && scheduledAt.getTime() <= Date.now())
      throw new BadRequestException({
        code: 'BROADCAST_SCHEDULE_MUST_BE_FUTURE',
        message: 'Schedule must be in the future',
      });
    try {
      const broadcast = await this.database.client.broadcast.create({
        data: {
          audience: dto.audience as unknown as Prisma.InputJsonValue,
          connectionId: dto.connectionId,
          content: templateVersion
            ? this.templateSnapshot(templateVersion)
            : { kind: 'TEXT', text: dto.text! },
          createdById: context.actorUserId,
          name: dto.name.trim(),
          projectId,
          templateVersionId: templateVersion?.id ?? null,
          scheduledAt,
          status: scheduledAt ? 'SCHEDULED' : 'DRAFT',
        },
        include: {
          connection: { select: { botUsername: true } },
          _count: { select: { recipients: true } },
        },
      });
      await this.audit.record({
        action: 'broadcast.create',
        actorEmailSnapshot: context.actorEmail,
        actorUserId: context.actorUserId,
        afterSafeJson: { connectionId: dto.connectionId, status: broadcast.status },
        correlationId: context.correlationId,
        entityId: broadcast.id,
        entityType: 'Broadcast',
        ip: context.ip,
        projectId,
        userAgent: context.userAgent,
      });
      return this.safe(broadcast);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException({
          code: 'BROADCAST_NAME_EXISTS',
          message: 'Broadcast name already exists',
        });
      throw error;
    }
  }

  async update(
    projectId: string,
    broadcastId: string,
    dto: UpdateBroadcastDto,
    context: AuditContext,
  ) {
    const current = await this.broadcast(projectId, broadcastId);
    if (!['DRAFT', 'SCHEDULED'].includes(current.status))
      throw new ConflictException({
        code: 'BROADCAST_NOT_EDITABLE',
        message: 'Broadcast is not editable',
      });
    if (dto.audience) this.assertAudience(dto.audience);
    const templateVersion = dto.templateVersionId
      ? await this.templateVersion(projectId, dto.templateVersionId)
      : undefined;
    const scheduledAt =
      dto.scheduledAt === undefined
        ? undefined
        : dto.scheduledAt === null
          ? null
          : new Date(dto.scheduledAt);
    if (scheduledAt && scheduledAt.getTime() <= Date.now())
      throw new BadRequestException({
        code: 'BROADCAST_SCHEDULE_MUST_BE_FUTURE',
        message: 'Schedule must be in the future',
      });
    const broadcast = await this.database.client.broadcast.update({
      where: { projectId_id: { id: broadcastId, projectId } },
      data: {
        ...(dto.audience ? { audience: dto.audience as unknown as Prisma.InputJsonValue } : {}),
        ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
        ...(templateVersion
          ? {
              content: this.templateSnapshot(templateVersion),
              templateVersionId: templateVersion.id,
            }
          : dto.text === undefined
            ? {}
            : { content: { kind: 'TEXT', text: dto.text }, templateVersionId: null }),
        ...(scheduledAt === undefined
          ? {}
          : { scheduledAt, status: scheduledAt ? 'SCHEDULED' : 'DRAFT' }),
      },
      include: {
        connection: { select: { botUsername: true } },
        _count: { select: { recipients: true } },
      },
    });
    await this.audit.record({
      action: 'broadcast.update',
      actorEmailSnapshot: context.actorEmail,
      actorUserId: context.actorUserId,
      correlationId: context.correlationId,
      entityId: broadcastId,
      entityType: 'Broadcast',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
    return this.safe(broadcast);
  }

  async estimate(projectId: string, broadcastId: string) {
    const broadcast = await this.broadcast(projectId, broadcastId);
    return {
      eligibleRecipients: await this.countAudience(
        projectId,
        broadcast.connectionId,
        broadcast.audience as unknown as Audience,
      ),
    };
  }

  async launch(projectId: string, broadcastId: string, context: AuditContext) {
    const broadcast = await this.broadcast(projectId, broadcastId);
    if (!['DRAFT', 'SCHEDULED'].includes(broadcast.status))
      throw new ConflictException({
        code: 'BROADCAST_CANNOT_LAUNCH',
        message: 'Broadcast cannot be launched',
      });
    await this.assertConnection(projectId, broadcast.connectionId);
    const claimed = await this.database.client.broadcast.updateMany({
      where: { id: broadcastId, projectId, status: { in: ['DRAFT', 'SCHEDULED'] } },
      data: { status: 'PREPARING', startedAt: new Date(), scheduledAt: null },
    });
    if (!claimed.count)
      throw new ConflictException({
        code: 'BROADCAST_STATE_CHANGED',
        message: 'Broadcast state changed',
      });
    await this.audit.record({
      action: 'broadcast.launch',
      actorEmailSnapshot: context.actorEmail,
      actorUserId: context.actorUserId,
      afterSafeJson: { status: 'PREPARING' },
      correlationId: context.correlationId,
      entityId: broadcastId,
      entityType: 'Broadcast',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
    return this.get(projectId, broadcastId);
  }

  async pause(projectId: string, broadcastId: string, context: AuditContext) {
    const updated = await this.database.client.broadcast.updateMany({
      where: { id: broadcastId, projectId, status: 'RUNNING' },
      data: { status: 'PAUSED', pausedAt: new Date() },
    });
    if (!updated.count)
      throw new ConflictException({
        code: 'BROADCAST_CANNOT_PAUSE',
        message: 'Broadcast is not running',
      });
    await this.auditEvent('broadcast.pause', projectId, broadcastId, context);
    return this.get(projectId, broadcastId);
  }

  async resume(projectId: string, broadcastId: string, context: AuditContext) {
    const updated = await this.database.client.broadcast.updateMany({
      where: { id: broadcastId, projectId, status: 'PAUSED' },
      data: { status: 'RUNNING', pausedAt: null },
    });
    if (!updated.count)
      throw new ConflictException({
        code: 'BROADCAST_CANNOT_RESUME',
        message: 'Broadcast is not paused',
      });
    const outboxes = await this.database.client.broadcastRecipient.findMany({
      where: { broadcastId, projectId, status: 'QUEUED', outboxRecordId: { not: null } },
      select: { outboxRecordId: true },
    });
    await this.database.client.outboxRecord.updateMany({
      where: {
        id: { in: outboxes.flatMap((row) => (row.outboxRecordId ? [row.outboxRecordId] : [])) },
        projectId,
        status: 'RETRY',
      },
      data: { nextAttemptAt: new Date() },
    });
    await this.enqueue(outboxes.flatMap((row) => (row.outboxRecordId ? [row.outboxRecordId] : [])));
    await this.auditEvent('broadcast.resume', projectId, broadcastId, context);
    return this.get(projectId, broadcastId);
  }

  async cancel(projectId: string, broadcastId: string, context: AuditContext) {
    const broadcast = await this.broadcast(projectId, broadcastId);
    if (!['DRAFT', 'SCHEDULED', 'PREPARING', 'RUNNING', 'PAUSED'].includes(broadcast.status))
      throw new ConflictException({
        code: 'BROADCAST_CANNOT_CANCEL',
        message: 'Broadcast cannot be cancelled',
      });
    await this.database.client.$transaction(async (tx) => {
      await tx.broadcast.update({
        where: { projectId_id: { id: broadcastId, projectId } },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      const recipients = await tx.broadcastRecipient.findMany({
        where: { projectId, broadcastId, status: { in: ['PENDING', 'QUEUED'] } },
        select: { messageId: true, outboxRecordId: true },
      });
      await tx.broadcastRecipient.updateMany({
        where: { projectId, broadcastId, status: { in: ['PENDING', 'QUEUED'] } },
        data: { status: 'CANCELLED', completedAt: new Date(), lastError: 'broadcast_cancelled' },
      });
      const messageIds = recipients.flatMap((row) => (row.messageId ? [row.messageId] : []));
      const outboxIds = recipients.flatMap((row) =>
        row.outboxRecordId ? [row.outboxRecordId] : [],
      );
      await tx.message.updateMany({
        where: { id: { in: messageIds }, projectId, status: 'QUEUED' },
        data: { status: 'FAILED', failedAt: new Date() },
      });
      await tx.outboxRecord.updateMany({
        where: { id: { in: outboxIds }, projectId, status: { in: ['PENDING', 'RETRY'] } },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          lastError: 'broadcast_cancelled',
          lockedAt: null,
          lockedBy: null,
        },
      });
    });
    await this.auditEvent('broadcast.cancel', projectId, broadcastId, context);
    return this.get(projectId, broadcastId);
  }

  async retryFailed(projectId: string, broadcastId: string, context: AuditContext) {
    const broadcast = await this.broadcast(projectId, broadcastId);
    if (broadcast.status !== 'RUNNING')
      throw new ConflictException({
        code: 'BROADCAST_NOT_RUNNING',
        message: 'Broadcast is not running',
      });
    const recipients = await this.database.client.broadcastRecipient.findMany({
      where: { projectId, broadcastId, status: 'FAILED', outboxRecordId: { not: null } },
      select: { id: true, messageId: true, outboxRecordId: true },
    });
    const outboxIds = recipients.flatMap((row) => (row.outboxRecordId ? [row.outboxRecordId] : []));
    await this.database.client.$transaction(async (tx) => {
      await tx.broadcastRecipient.updateMany({
        where: { id: { in: recipients.map((row) => row.id) }, projectId },
        data: { status: 'QUEUED', lastError: null, completedAt: null },
      });
      await tx.message.updateMany({
        where: {
          id: { in: recipients.flatMap((row) => (row.messageId ? [row.messageId] : [])) },
          projectId,
        },
        data: { status: 'QUEUED', failedAt: null },
      });
      await tx.outboxRecord.updateMany({
        where: { id: { in: outboxIds }, projectId, status: 'FAILED' },
        data: {
          status: 'PENDING',
          attempts: 0,
          completedAt: null,
          lastError: null,
          nextAttemptAt: new Date(),
        },
      });
    });
    await this.enqueue(outboxIds);
    await this.auditEvent('broadcast.retry_failed', projectId, broadcastId, context, {
      recipientCount: recipients.length,
    });
    return this.get(projectId, broadcastId);
  }

  async archive(projectId: string, broadcastId: string, context: AuditContext) {
    const broadcast = await this.broadcast(projectId, broadcastId);
    if (['PREPARING', 'RUNNING', 'PAUSED'].includes(broadcast.status))
      throw new ConflictException({
        code: 'BROADCAST_MUST_BE_STOPPED',
        message: 'Stop the broadcast before archiving it',
      });
    const archived = await this.database.client.broadcast.update({
      data: { status: 'ARCHIVED' },
      where: { projectId_id: { id: broadcastId, projectId } },
      include: {
        connection: { select: { botUsername: true } },
        _count: { select: { recipients: true } },
      },
    });
    await this.auditEvent('broadcast.archive', projectId, broadcastId, context, {
      status: 'ARCHIVED',
    });
    return this.safe(archived);
  }

  async restore(projectId: string, broadcastId: string, context: AuditContext) {
    const broadcast = await this.broadcast(projectId, broadcastId);
    if (broadcast.status !== 'ARCHIVED')
      throw new ConflictException({
        code: 'BROADCAST_NOT_ARCHIVED',
        message: 'Broadcast is not archived',
      });
    const status = broadcast.completedAt
      ? 'COMPLETED'
      : broadcast.cancelledAt
        ? 'CANCELLED'
        : broadcast.failedAt
          ? 'FAILED'
          : 'DRAFT';
    const restored = await this.database.client.broadcast.update({
      data: { status },
      where: { projectId_id: { id: broadcastId, projectId } },
      include: {
        connection: { select: { botUsername: true } },
        _count: { select: { recipients: true } },
      },
    });
    await this.auditEvent('broadcast.restore', projectId, broadcastId, context, { status });
    return this.safe(restored);
  }

  async runAgain(projectId: string, broadcastId: string, context: AuditContext) {
    const source = await this.broadcast(projectId, broadcastId);
    if (!['COMPLETED', 'CANCELLED', 'FAILED', 'ARCHIVED'].includes(source.status))
      throw new ConflictException({
        code: 'BROADCAST_NOT_TERMINAL',
        message: 'Only a finished broadcast can be run again',
      });
    const name = await this.availableCopyName(projectId, source.name);
    const copy = await this.database.client.broadcast.create({
      data: {
        audience: source.audience as Prisma.InputJsonValue,
        connectionId: source.connectionId,
        content: source.content as Prisma.InputJsonValue,
        createdById: context.actorUserId,
        name,
        projectId,
        status: 'DRAFT',
        templateVersionId: source.templateVersionId,
      },
      include: {
        connection: { select: { botUsername: true } },
        _count: { select: { recipients: true } },
      },
    });
    await this.auditEvent('broadcast.run_again', projectId, copy.id, context, {
      sourceBroadcastId: broadcastId,
      status: 'DRAFT',
    });
    return this.safe(copy);
  }

  async recipients(projectId: string, broadcastId: string, query: BroadcastRecipientsQueryDto) {
    await this.broadcast(projectId, broadcastId);
    const where = {
      projectId,
      broadcastId,
      ...(query.status ? { status: query.status as never } : {}),
    };
    const [items, total] = await this.database.client.$transaction([
      this.database.client.broadcastRecipient.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'asc' },
        include: {
          contact: { select: { displayName: true } },
          channelIdentity: { select: { username: true, externalUserId: true } },
        },
      }),
      this.database.client.broadcastRecipient.count({ where }),
    ]);
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  private async prepareAndQueue(projectId: string, broadcastId: string): Promise<number> {
    const broadcast = await this.broadcast(projectId, broadcastId);
    if (broadcast.status !== 'PREPARING') return 0;
    const identities = await this.audienceIdentities(
      projectId,
      broadcast.connectionId,
      broadcast.audience as unknown as Audience,
    );
    await this.database.client.$transaction(async (tx) => {
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
        where: { id: broadcastId, projectId, status: 'PREPARING' },
        data: {
          status: identities.length ? 'RUNNING' : 'COMPLETED',
          completedAt: identities.length ? null : new Date(),
        },
      });
    });
    const pending = await this.database.client.broadcastRecipient.findMany({
      where: { broadcastId, projectId, status: 'PENDING' },
      select: { id: true, contactId: true, channelIdentityId: true },
    });
    const outboxIds: string[] = [];
    for (const recipient of pending) {
      const identity = identities.find((candidate) => candidate.id === recipient.channelIdentityId);
      if (!identity) continue;
      const rendered = renderMessageTemplateContent(broadcast.content, {
        contact: identity.contact,
      });
      if (rendered.missing.length) {
        await this.database.client.broadcastRecipient.updateMany({
          data: {
            completedAt: new Date(),
            lastError: 'broadcast_template_variable_missing',
            status: 'FAILED',
          },
          where: { id: recipient.id, projectId, status: 'PENDING' },
        });
        continue;
      }
      const result = await this.database.client.$transaction(async (tx) => {
        const current = await tx.broadcast.findUnique({
          where: { projectId_id: { id: broadcastId, projectId } },
        });
        if (!current || current.status !== 'RUNNING') return null;
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
            type: this.messageType(rendered.content),
            mediaAssetId: this.mediaAssetId(rendered.content),
            status: 'QUEUED',
            content: rendered.content as Prisma.InputJsonValue,
            metadata: {
              source: 'broadcast',
              broadcastId,
              broadcastRecipientId: recipient.id,
              templateVersionId: current.templateVersionId,
            },
          },
        });
        const outbox = await tx.outboxRecord.create({
          data: {
            projectId,
            connectionId: broadcast.connectionId,
            kind: 'TELEGRAM',
            idempotencyKey: `broadcast-recipient-${recipient.id}`,
            nextAttemptAt: new Date(),
            payload: { messageId: message.id, channelIdentityId: recipient.channelIdentityId },
          },
        });
        const claimed = await tx.broadcastRecipient.updateMany({
          where: { id: recipient.id, projectId, status: 'PENDING' },
          data: {
            status: 'QUEUED',
            messageId: message.id,
            outboxRecordId: outbox.id,
            queuedAt: new Date(),
          },
        });
        if (!claimed.count) return null;
        return outbox.id;
      });
      if (result) outboxIds.push(result);
    }
    await this.enqueue(outboxIds);
    await this.completeIfTerminal(projectId, broadcastId);
    return outboxIds.length;
  }

  private async enqueue(outboxIds: readonly string[]) {
    await Promise.all(
      outboxIds.map(async (id) => {
        try {
          await this.outbound.enqueue(id);
        } catch {
          /* PostgreSQL recovery owns the durable retry */
        }
      }),
    );
  }

  private async countAudience(projectId: string, connectionId: string, audience: Audience) {
    return this.database.client.channelIdentity.count({
      where: await this.audienceWhere(projectId, connectionId, audience),
    });
  }

  private async audienceIdentities(projectId: string, connectionId: string, audience: Audience) {
    return this.database.client.channelIdentity.findMany({
      where: await this.audienceWhere(projectId, connectionId, audience),
      select: {
        id: true,
        contactId: true,
        externalUserId: true,
        contact: {
          select: {
            customFields: true,
            displayName: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            username: true,
          },
        },
      },
    });
  }

  private async completeIfTerminal(projectId: string, broadcastId: string): Promise<void> {
    const nonTerminal = await this.database.client.broadcastRecipient.count({
      where: {
        broadcastId,
        projectId,
        status: { in: ['PENDING', 'QUEUED', 'PROCESSING'] },
      },
    });
    if (nonTerminal === 0)
      await this.database.client.broadcast.updateMany({
        data: { completedAt: new Date(), status: 'COMPLETED' },
        where: { id: broadcastId, projectId, status: 'RUNNING' },
      });
  }

  private async audienceWhere(
    projectId: string,
    connectionId: string,
    audience: Audience,
  ): Promise<Prisma.ChannelIdentityWhereInput> {
    this.assertAudience(audience);
    const contactWhere: Prisma.ContactWhereInput = { projectId, status: 'ACTIVE' };
    if (audience.mode === 'CONTACTS') contactWhere.id = { in: audience.contactIds! };
    if (audience.mode === 'SEGMENT') {
      const segment = await this.database.client.segment.findFirst({
        where: { id: audience.segmentId!, projectId, status: 'ACTIVE', archivedAt: null },
      });
      if (!segment)
        throw new NotFoundException({
          code: 'SEGMENT_NOT_FOUND',
          message: 'Segment was not found',
        });
      Object.assign(contactWhere, await this.segmentWhere(projectId, segment.filter));
    }
    const tagClauses: Prisma.ContactWhereInput[] = [];
    for (const tagId of audience.includeTagIds ?? [])
      tagClauses.push({ tags: { some: { projectId, tagId } } });
    if (audience.excludeTagIds?.length)
      tagClauses.push({ tags: { none: { projectId, tagId: { in: audience.excludeTagIds } } } });
    if (tagClauses.length) contactWhere.AND = tagClauses;
    return {
      channel: 'TELEGRAM',
      connectionId,
      projectId,
      status: 'ACTIVE',
      contact: { is: contactWhere },
    };
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
      const projection =
        typeof customValue === 'number'
          ? { valueNumber: customValue }
          : typeof customValue === 'boolean'
            ? { valueBoolean: customValue }
            : { valueText: String(customValue) };
      where.customFieldValues = { some: { definitionId: definition.id, projectId, ...projection } };
    }
    return where;
  }

  private assertAudience(audience: Audience) {
    if (audience.mode === 'SEGMENT' && !audience.segmentId)
      throw new BadRequestException({
        code: 'BROADCAST_SEGMENT_REQUIRED',
        message: 'Segment is required',
      });
    if (audience.mode === 'CONTACTS' && !audience.contactIds?.length)
      throw new BadRequestException({
        code: 'BROADCAST_CONTACTS_REQUIRED',
        message: 'Contacts are required',
      });
    if (
      new Set(audience.includeTagIds ?? []).size !== (audience.includeTagIds ?? []).length ||
      new Set(audience.excludeTagIds ?? []).size !== (audience.excludeTagIds ?? []).length
    )
      throw new BadRequestException({
        code: 'BROADCAST_TAGS_INVALID',
        message: 'Audience tags must be unique',
      });
  }

  private async assertConnection(projectId: string, connectionId: string) {
    const connection = await this.database.client.channelConnection.findUnique({
      where: { projectId_id: { id: connectionId, projectId } },
    });
    if (!connection || connection.type !== 'TELEGRAM')
      throw new NotFoundException({
        code: 'CHANNEL_NOT_FOUND',
        message: 'Telegram channel was not found',
      });
    if (connection.status !== 'ACTIVE')
      throw new ConflictException({
        code: 'CHANNEL_NOT_ACTIVE',
        message: 'Telegram channel is not active',
      });
  }

  private async broadcast(
    projectId: string,
    broadcastId: string,
    include?: Prisma.BroadcastInclude,
  ) {
    const row = await this.database.client.broadcast.findUnique({
      where: { projectId_id: { id: broadcastId, projectId } },
      ...(include ? { include } : {}),
    });
    if (!row)
      throw new NotFoundException({
        code: 'BROADCAST_NOT_FOUND',
        message: 'Broadcast was not found',
      });
    return row;
  }

  private async availableCopyName(projectId: string, sourceName: string) {
    for (let suffix = 1; suffix <= 100; suffix += 1) {
      const candidate = `${sourceName} (run ${suffix})`;
      const existing = await this.database.client.broadcast.findUnique({
        select: { id: true },
        where: { projectId_name: { name: candidate, projectId } },
      });
      if (!existing) return candidate;
    }
    throw new ConflictException({
      code: 'BROADCAST_COPY_NAME_UNAVAILABLE',
      message: 'A new broadcast name could not be allocated',
    });
  }

  private safe(broadcast: {
    id: string;
    projectId: string;
    name: string;
    connectionId: string;
    status: string;
    audience: Prisma.JsonValue;
    content: Prisma.JsonValue;
    scheduledAt: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
    pausedAt: Date | null;
    cancelledAt: Date | null;
    failedAt: Date | null;
    errorCode: string | null;
    createdAt: Date;
    updatedAt: Date;
    connection?: { botUsername: string | null };
    _count?: { recipients: number };
  }) {
    return {
      ...broadcast,
      text: this.text(broadcast.content),
      recipientCount: broadcast._count?.recipients ?? 0,
    };
  }

  private async templateVersion(projectId: string, templateVersionId: string) {
    const version = await this.database.client.messageTemplateVersion.findFirst({
      where: {
        id: templateVersionId,
        projectId,
        status: 'PUBLISHED',
        template: { status: 'PUBLISHED' },
      },
    });
    if (!version)
      throw new BadRequestException({
        code: 'BROADCAST_TEMPLATE_VERSION_INVALID',
        message: 'A published template version is required',
      });
    return version;
  }

  private templateSnapshot(version: {
    content: Prisma.JsonValue;
    id: string;
    kind: 'ANIMATION' | 'AUDIO' | 'DOCUMENT' | 'PHOTO' | 'TEXT' | 'VIDEO' | 'VIDEO_NOTE' | 'VOICE';
    mediaAssetId: string | null;
    templateId: string;
  }): Prisma.InputJsonValue {
    return {
      ...(version.content as object),
      kind: version.kind,
      mediaAssetId: version.mediaAssetId,
      templateId: version.templateId,
      templateVersionId: version.id,
    } as Prisma.InputJsonValue;
  }

  private mediaAssetId(content: unknown): string | null {
    if (!content || typeof content !== 'object' || Array.isArray(content)) return null;
    const value = (content as Record<string, Prisma.JsonValue>).mediaAssetId;
    return typeof value === 'string' ? value : null;
  }

  private messageType(
    content: unknown,
  ): 'ANIMATION' | 'AUDIO' | 'DOCUMENT' | 'PHOTO' | 'TEXT' | 'VIDEO' | 'VIDEO_NOTE' | 'VOICE' {
    if (!content || typeof content !== 'object' || Array.isArray(content)) return 'TEXT';
    const kind = (content as Record<string, Prisma.JsonValue>).kind;
    return ['PHOTO', 'DOCUMENT', 'VIDEO', 'AUDIO', 'VOICE', 'VIDEO_NOTE', 'ANIMATION'].includes(
      String(kind),
    )
      ? (kind as 'ANIMATION' | 'AUDIO' | 'DOCUMENT' | 'PHOTO' | 'VIDEO' | 'VIDEO_NOTE' | 'VOICE')
      : 'TEXT';
  }

  private text(value: Prisma.JsonValue): string {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    const content = value as { caption?: unknown; text?: unknown };
    return typeof content.text === 'string'
      ? content.text
      : typeof content.caption === 'string'
        ? content.caption
        : '';
  }

  private async auditEvent(
    action: string,
    projectId: string,
    broadcastId: string,
    context: AuditContext,
    afterSafeJson?: Prisma.InputJsonValue,
  ) {
    await this.audit.record({
      action,
      actorEmailSnapshot: context.actorEmail,
      actorUserId: context.actorUserId,
      afterSafeJson,
      correlationId: context.correlationId,
      entityId: broadcastId,
      entityType: 'Broadcast',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
  }
}
