import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@omnicus/database';

import type { AuthenticatedUser } from '../auth/auth.types';
import type { RequestSecurityContext } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import type { RetryCrmOperationDto, UpsertCrmProjectConfigDto } from './dto';

type SafeCrmOperation = {
  attempts: number;
  createdAt: Date;
  id: string;
  lastError: string | null;
  resultSafe: unknown;
  status: 'FAILED' | 'PENDING' | 'PROCESSING' | 'RETRY' | 'SUCCEEDED' | 'UNKNOWN';
  type: 'CREATE_OR_UPDATE_LEAD' | 'FORWARD_INBOUND_MESSAGE';
  updatedAt: Date;
};

@Injectable()
export class CrmService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async getConfig(projectId: string) {
    return this.database.client.crmProjectConfig.findUnique({ where: { projectId } });
  }

  async upsertConfig(
    projectId: string,
    dto: UpsertCrmProjectConfigDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const update: Prisma.CrmProjectConfigUpdateInput = { crmProjectId: dto.crmProjectId };
    if (dto.additionalParameters !== undefined)
      update.additionalParameters = this.json(dto.additionalParameters);
    if (dto.defaultPipeline !== undefined) update.defaultPipeline = dto.defaultPipeline;
    if (dto.defaultStage !== undefined) update.defaultStage = dto.defaultStage;
    if (dto.enabled !== undefined) update.enabled = dto.enabled;
    if (dto.fieldMapping !== undefined) update.fieldMapping = this.json(dto.fieldMapping);
    const config = await this.database.client.crmProjectConfig.upsert({
      create: {
        additionalParameters: this.json(dto.additionalParameters ?? {}),
        crmProjectId: dto.crmProjectId,
        defaultPipeline: dto.defaultPipeline ?? null,
        defaultStage: dto.defaultStage ?? null,
        enabled: dto.enabled ?? true,
        fieldMapping: this.json(dto.fieldMapping ?? {}),
        projectId,
      },
      update,
      where: { projectId },
    });
    await this.audit.record({
      action: 'crm.project_config.upsert',
      actorUserId: actor.userId,
      afterSafeJson: { crmProjectId: config.crmProjectId, enabled: config.enabled },
      correlationId: context.correlationId,
      entityId: config.id,
      entityType: 'CrmProjectConfig',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
    return config;
  }

  async listOperations(projectId: string): Promise<SafeCrmOperation[]> {
    const operations = await this.database.client.crmOperation.findMany({
      include: { outbox: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
      where: { projectId },
    });
    return operations.map((operation) => this.safeOperation(operation));
  }

  async retryOperation(
    projectId: string,
    operationId: string,
    dto: RetryCrmOperationDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ): Promise<SafeCrmOperation> {
    const retryResult = await this.database.client.$transaction(async (transaction) => {
      const current = await transaction.crmOperation.findUnique({
        include: { outbox: true },
        where: { projectId_id: { id: operationId, projectId } },
      });
      if (!current) throw new NotFoundException({ code: 'CRM_OPERATION_NOT_FOUND' });
      if (!['FAILED', 'UNKNOWN'].includes(current.outbox.status))
        throw new BadRequestException({ code: 'CRM_OPERATION_NOT_TERMINAL' });
      if (current.outbox.status === 'UNKNOWN' && dto.confirmUnknownDelivery !== true)
        throw new BadRequestException({ code: 'CRM_UNKNOWN_RETRY_CONFIRMATION_REQUIRED' });
      const updated = await transaction.outboxRecord.updateMany({
        data: {
          attempts: 0,
          completedAt: null,
          lastError: null,
          lockedAt: null,
          lockedBy: null,
          nextAttemptAt: new Date(),
          status: 'PENDING',
        },
        where: {
          id: current.outboxRecordId,
          projectId,
          status: current.outbox.status,
        },
      });
      if (updated.count !== 1)
        throw new BadRequestException({ code: 'CRM_OPERATION_STATE_CHANGED' });
      const refreshed = await transaction.crmOperation.findUniqueOrThrow({
        include: { outbox: true },
        where: { projectId_id: { id: operationId, projectId } },
      });
      return { operation: refreshed, retriedUnknown: current.outbox.status === 'UNKNOWN' };
    });
    await this.audit.record({
      action: 'crm.operation.manual_retry_requested',
      actorUserId: actor.userId,
      afterSafeJson: {
        confirmedUnknownDelivery: retryResult.retriedUnknown,
        operationType: retryResult.operation.type,
      },
      correlationId: context.correlationId,
      entityId: operationId,
      entityType: 'CrmOperation',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
    return this.safeOperation(retryResult.operation);
  }

  private json(value: Record<string, unknown>): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private safeOperation(operation: {
    createdAt: Date;
    id: string;
    resultSafe: unknown;
    type: 'CREATE_OR_UPDATE_LEAD' | 'FORWARD_INBOUND_MESSAGE';
    updatedAt: Date;
    outbox: {
      attempts: number;
      lastError: string | null;
      status: 'FAILED' | 'PENDING' | 'PROCESSING' | 'RETRY' | 'SUCCEEDED' | 'UNKNOWN';
    };
  }): SafeCrmOperation {
    return {
      attempts: operation.outbox.attempts,
      createdAt: operation.createdAt,
      id: operation.id,
      lastError: operation.outbox.lastError,
      resultSafe: operation.resultSafe,
      status: operation.outbox.status,
      type: operation.type,
      updatedAt: operation.updatedAt,
    };
  }
}
