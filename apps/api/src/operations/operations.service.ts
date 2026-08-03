import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@omnicus/database';

import type { AuthenticatedUser } from '../auth/auth.types';
import type { RequestSecurityContext } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { TelegramOutboundQueueService } from '../channels/telegram-outbound-queue.service';
import { DatabaseService } from '../database/database.service';
import { TelegramInboundQueueService } from '../telegram-webhook/telegram-inbound-queue.service';
import type { AuditQueryDto, ManualRetryDto, OperationsQueryDto, ReconcileUnknownDto } from './dto';

type OperationSource = 'AUTOMATION' | 'BROADCAST' | 'INBOX' | 'OUTBOX';

interface SafeOperation {
  attempts?: number;
  correlationId?: string | undefined;
  createdAt: Date;
  entityId?: string | undefined;
  entityType: string;
  errorCode?: string | undefined;
  id: string;
  kind?: string | undefined;
  maxAttempts?: number | undefined;
  reconciliationAvailable: boolean;
  retryAvailable: boolean;
  source: OperationSource;
  status: string;
  updatedAt: Date;
}

function dateWhere(query: { from?: string; to?: string }): Prisma.DateTimeFilter | undefined {
  if (!query.from && !query.to) return undefined;
  return {
    ...(query.from ? { gte: new Date(query.from) } : {}),
    ...(query.to ? { lte: new Date(query.to) } : {}),
  };
}

function safeCode(value: Prisma.JsonValue | null | undefined): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const code = (value as Record<string, unknown>).code;
  return typeof code === 'string' ? code : undefined;
}

@Injectable()
export class OperationsService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(TelegramInboundQueueService) private readonly inbound: TelegramInboundQueueService,
    @Inject(TelegramOutboundQueueService) private readonly outbound: TelegramOutboundQueueService,
  ) {}

  async list(projectId: string, query: OperationsQueryDto) {
    const take = 500;
    const createdAt = dateWhere(query);
    const source = query.source;
    const rows: SafeOperation[] = [];

    if (!source || source === 'INBOX') {
      const inbox = await this.database.client.inboxRecord.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          attempts: true,
          connectionId: true,
          createdAt: true,
          id: true,
          lastError: true,
          maxAttempts: true,
          rawWebhookEvent: { select: { correlationId: true } },
          status: true,
          updatedAt: true,
        },
        take,
        where: {
          projectId,
          ...(createdAt ? { createdAt } : {}),
          ...(query.connectionId ? { connectionId: query.connectionId } : {}),
          ...(query.status ? { status: query.status as never } : {}),
          ...(query.correlationId
            ? { rawWebhookEvent: { correlationId: { contains: query.correlationId } } }
            : {}),
        },
      });
      rows.push(
        ...inbox.map((row): SafeOperation => ({
          attempts: row.attempts,
          correlationId: row.rawWebhookEvent.correlationId,
          createdAt: row.createdAt,
          entityType: 'Inbound webhook',
          errorCode: row.lastError ?? undefined,
          id: row.id,
          maxAttempts: row.maxAttempts,
          reconciliationAvailable: false,
          retryAvailable: row.status === 'FAILED' || row.status === 'DEAD_LETTER',
          source: 'INBOX',
          status: row.status,
          updatedAt: row.updatedAt,
        })),
      );
    }

    if (!source || source === 'OUTBOX') {
      const outbox = await this.database.client.outboxRecord.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          attempts: true,
          broadcastRecipient: { select: { broadcastId: true } },
          connectionId: true,
          createdAt: true,
          crmOperation: { select: { id: true, type: true } },
          externalHttpOperation: {
            select: { execution: { select: { correlationId: true } }, id: true },
          },
          id: true,
          kind: true,
          lastError: true,
          maxAttempts: true,
          status: true,
          updatedAt: true,
        },
        take,
        where: {
          projectId,
          ...(createdAt ? { createdAt } : {}),
          ...(query.connectionId ? { connectionId: query.connectionId } : {}),
          ...(query.status ? { status: query.status as never } : {}),
          ...(query.correlationId
            ? {
                externalHttpOperation: {
                  execution: { correlationId: { contains: query.correlationId } },
                },
              }
            : {}),
        },
      });
      rows.push(
        ...outbox.map((row): SafeOperation => {
          const externalHttp = Boolean(row.externalHttpOperation);
          const entityType = externalHttp
            ? 'External HTTP request'
            : row.crmOperation
              ? `CRM ${row.crmOperation.type.toLocaleLowerCase('en-US').replaceAll('_', ' ')}`
              : row.broadcastRecipient
                ? 'Broadcast delivery'
                : 'Telegram delivery';
          return {
            attempts: row.attempts,
            correlationId: row.externalHttpOperation?.execution.correlationId,
            createdAt: row.createdAt,
            entityId:
              row.externalHttpOperation?.id ??
              row.crmOperation?.id ??
              row.broadcastRecipient?.broadcastId,
            entityType,
            errorCode: row.lastError ?? undefined,
            id: row.id,
            kind: row.kind,
            maxAttempts: row.maxAttempts,
            reconciliationAvailable:
              row.kind === 'TELEGRAM' && !externalHttp && row.status === 'UNKNOWN',
            retryAvailable: row.kind === 'TELEGRAM' && !externalHttp && row.status === 'FAILED',
            source: 'OUTBOX',
            status: row.status,
            updatedAt: row.updatedAt,
          };
        }),
      );
    }

    if (!source || source === 'AUTOMATION') {
      const executions = await this.database.client.scenarioExecution.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          correlationId: true,
          createdAt: true,
          errorSafe: true,
          id: true,
          scenario: { select: { name: true } },
          scenarioId: true,
          status: true,
          updatedAt: true,
        },
        take,
        where: {
          projectId,
          ...(createdAt ? { createdAt } : {}),
          ...(query.status ? { status: query.status as never } : {}),
          ...(query.correlationId ? { correlationId: { contains: query.correlationId } } : {}),
        },
      });
      rows.push(
        ...executions.map((row): SafeOperation => ({
          correlationId: row.correlationId,
          createdAt: row.createdAt,
          entityId: row.scenarioId,
          entityType: `Automation: ${row.scenario.name}`,
          errorCode: safeCode(row.errorSafe),
          id: row.id,
          reconciliationAvailable: false,
          retryAvailable: false,
          source: 'AUTOMATION',
          status: row.status,
          updatedAt: row.updatedAt,
        })),
      );
    }

    if (!source || source === 'BROADCAST') {
      const broadcasts = await this.database.client.broadcast.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          connectionId: true,
          createdAt: true,
          errorCode: true,
          id: true,
          name: true,
          status: true,
          updatedAt: true,
        },
        take,
        where: {
          projectId,
          ...(createdAt ? { createdAt } : {}),
          ...(query.connectionId ? { connectionId: query.connectionId } : {}),
          ...(query.status ? { status: query.status as never } : {}),
          ...(query.correlationId ? { id: '__no_broadcast_correlation_match__' } : {}),
        },
      });
      rows.push(
        ...broadcasts.map((row): SafeOperation => ({
          createdAt: row.createdAt,
          entityType: `Broadcast: ${row.name}`,
          errorCode: row.errorCode ?? undefined,
          id: row.id,
          reconciliationAvailable: false,
          retryAvailable: false,
          source: 'BROADCAST',
          status: row.status,
          updatedAt: row.updatedAt,
        })),
      );
    }

    rows.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    const start = (query.page - 1) * query.pageSize;
    return {
      items: rows.slice(start, start + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total: rows.length,
    };
  }

  async summary(projectId: string) {
    const [inbox, outbox, executions, broadcasts] = await Promise.all([
      this.database.client.inboxRecord.groupBy({
        _count: { _all: true },
        by: ['status'],
        where: { projectId },
      }),
      this.database.client.outboxRecord.groupBy({
        _count: { _all: true },
        by: ['status'],
        where: { projectId },
      }),
      this.database.client.scenarioExecution.groupBy({
        _count: { _all: true },
        by: ['status'],
        where: { projectId },
      }),
      this.database.client.broadcast.groupBy({
        _count: { _all: true },
        by: ['status'],
        where: { projectId },
      }),
    ]);
    return { broadcasts, executions, inbox, outbox };
  }

  async auditHistory(projectId: string, query: AuditQueryDto) {
    const createdAt = dateWhere(query);
    const where: Prisma.AuditLogWhereInput = {
      projectId,
      ...(createdAt ? { createdAt } : {}),
      ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
      ...(query.correlationId ? { correlationId: { contains: query.correlationId } } : {}),
    };
    const [items, total] = await Promise.all([
      this.database.client.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          action: true,
          actorEmailSnapshot: true,
          actorType: true,
          afterSafeJson: true,
          beforeSafeJson: true,
          correlationId: true,
          createdAt: true,
          entityId: true,
          entityType: true,
          id: true,
          reason: true,
        },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        where,
      }),
      this.database.client.auditLog.count({ where }),
    ]);
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  async retryInbox(
    projectId: string,
    inboxRecordId: string,
    input: ManualRetryDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const record = await this.database.client.inboxRecord.findUnique({
      select: { attempts: true, id: true, status: true },
      where: { projectId_id: { id: inboxRecordId, projectId } },
    });
    if (!record) throw new NotFoundException({ code: 'OPERATION_NOT_FOUND' });
    if (record.status !== 'FAILED' && record.status !== 'DEAD_LETTER')
      throw new ConflictException({ code: 'OPERATION_NOT_RETRYABLE' });
    const updated = await this.database.client.inboxRecord.updateMany({
      data: {
        ...(input.resetAttempts ? { attempts: 0 } : {}),
        completedAt: null,
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt: new Date(),
        status: 'RETRY',
      },
      where: { id: inboxRecordId, projectId, status: record.status },
    });
    if (updated.count !== 1)
      throw new ConflictException({ code: 'OPERATION_CHANGED_REFRESH_REQUIRED' });
    await this.auditMutation(
      'operations.inbox.retry',
      projectId,
      inboxRecordId,
      input.reason,
      actor,
      context,
      {
        from: record.status,
        resetAttempts: input.resetAttempts,
        to: 'RETRY',
      },
    );
    try {
      await this.inbound.enqueue(inboxRecordId);
    } catch {
      // PostgreSQL remains authoritative; the recovery scan will enqueue it.
    }
    return { id: inboxRecordId, status: 'RETRY' as const };
  }

  async retryOutbox(
    projectId: string,
    outboxRecordId: string,
    input: ManualRetryDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const record = await this.database.client.outboxRecord.findUnique({
      select: {
        externalHttpOperation: { select: { id: true } },
        id: true,
        kind: true,
        status: true,
      },
      where: { projectId_id: { id: outboxRecordId, projectId } },
    });
    if (!record) throw new NotFoundException({ code: 'OPERATION_NOT_FOUND' });
    if (record.status !== 'FAILED' || record.kind !== 'TELEGRAM' || record.externalHttpOperation)
      throw new ConflictException({ code: 'OPERATION_NOT_RETRYABLE' });
    await this.requeueTelegramOutbox(projectId, outboxRecordId, 'FAILED');
    await this.auditMutation(
      'operations.outbox.retry',
      projectId,
      outboxRecordId,
      input.reason,
      actor,
      context,
      {
        from: 'FAILED',
        to: 'RETRY',
      },
    );
    try {
      await this.outbound.enqueue(outboxRecordId);
    } catch {
      // PostgreSQL remains authoritative; the recovery scan will enqueue it.
    }
    return { id: outboxRecordId, status: 'RETRY' as const };
  }

  async reconcileOutbox(
    projectId: string,
    outboxRecordId: string,
    input: ReconcileUnknownDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const record = await this.database.client.outboxRecord.findUnique({
      select: {
        externalHttpOperation: { select: { id: true } },
        id: true,
        kind: true,
        status: true,
      },
      where: { projectId_id: { id: outboxRecordId, projectId } },
    });
    if (!record) throw new NotFoundException({ code: 'OPERATION_NOT_FOUND' });
    if (record.status !== 'UNKNOWN' || record.kind !== 'TELEGRAM' || record.externalHttpOperation)
      throw new BadRequestException({ code: 'OPERATION_RECONCILIATION_UNAVAILABLE' });

    if (input.outcome === 'NOT_APPLIED') {
      await this.requeueTelegramOutbox(projectId, outboxRecordId, 'UNKNOWN');
      try {
        await this.outbound.enqueue(outboxRecordId);
      } catch {
        // The bounded recovery scan will enqueue the durable retry.
      }
    } else {
      await this.database.client.$transaction(async (transaction) => {
        const updated = await transaction.outboxRecord.updateMany({
          data: {
            completedAt: new Date(),
            lastError: null,
            lockedAt: null,
            lockedBy: null,
            nextAttemptAt: null,
            status: 'SUCCEEDED',
          },
          where: { id: outboxRecordId, projectId, status: 'UNKNOWN' },
        });
        if (updated.count !== 1)
          throw new ConflictException({ code: 'OPERATION_CHANGED_REFRESH_REQUIRED' });
        await this.markTelegramRelations(transaction, projectId, outboxRecordId, 'SENT');
      });
    }
    const status = input.outcome === 'APPLIED' ? 'SUCCEEDED' : 'RETRY';
    await this.auditMutation(
      'operations.outbox.reconciled',
      projectId,
      outboxRecordId,
      input.reason,
      actor,
      context,
      { evidence: input.outcome, from: 'UNKNOWN', to: status },
    );
    return { id: outboxRecordId, status };
  }

  private async requeueTelegramOutbox(
    projectId: string,
    outboxRecordId: string,
    expectedStatus: 'FAILED' | 'UNKNOWN',
  ): Promise<void> {
    await this.database.client.$transaction(async (transaction) => {
      const updated = await transaction.outboxRecord.updateMany({
        data: {
          attempts: 0,
          completedAt: null,
          lastError: null,
          lockedAt: null,
          lockedBy: null,
          nextAttemptAt: new Date(),
          status: 'RETRY',
        },
        where: { id: outboxRecordId, projectId, status: expectedStatus },
      });
      if (updated.count !== 1)
        throw new ConflictException({ code: 'OPERATION_CHANGED_REFRESH_REQUIRED' });
      await this.markTelegramRelations(transaction, projectId, outboxRecordId, 'QUEUED');
    });
  }

  private async markTelegramRelations(
    transaction: Prisma.TransactionClient,
    projectId: string,
    outboxRecordId: string,
    status: 'QUEUED' | 'SENT',
  ): Promise<void> {
    await Promise.all([
      transaction.message.updateMany({
        data:
          status === 'SENT'
            ? { failedAt: null, sentAt: new Date(), status }
            : { failedAt: null, sentAt: null, status },
        where: {
          projectId,
          OR: [
            { broadcastRecipient: { outboxRecordId } },
            { scheduledMessage: { outboxRecordId } },
            { metadata: { path: ['outboxRecordId'], equals: outboxRecordId } },
          ],
        },
      }),
      transaction.broadcastRecipient.updateMany({
        data:
          status === 'SENT'
            ? { completedAt: new Date(), lastError: null, status }
            : { completedAt: null, lastError: null, queuedAt: new Date(), status },
        where: { outboxRecordId, projectId },
      }),
      transaction.scheduledMessage.updateMany({
        data:
          status === 'SENT' ? { completedAt: new Date(), status } : { completedAt: null, status },
        where: { outboxRecordId, projectId },
      }),
      transaction.telegramMediaGroup.updateMany({
        data:
          status === 'SENT' ? { completedAt: new Date(), status } : { completedAt: null, status },
        where: { outboxRecordId, projectId },
      }),
    ]);
  }

  private async auditMutation(
    action: string,
    projectId: string,
    entityId: string,
    reason: string,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
    afterSafeJson: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.audit.record({
      action,
      actorEmailSnapshot: actor.email,
      actorUserId: actor.userId,
      afterSafeJson,
      correlationId: context.correlationId,
      entityId,
      entityType: 'Operation',
      ip: context.ip,
      projectId,
      reason: reason.trim(),
      userAgent: context.userAgent,
    });
  }
}
