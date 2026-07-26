import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { CrmMockError, MockCrmClient } from '@omnicus/crm-core';

import { DatabaseService } from '../database/database.service';

@Injectable()
export class CrmMockOutboxService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly client = new MockCrmClient();
  private readonly logger = new Logger(CrmMockOutboxService.name);
  private timer: NodeJS.Timeout | undefined;
  private scanning = false;

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.scanOnce(), 5_000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async scanOnce(now = new Date()): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const rows = await this.database.client.outboxRecord.findMany({
        orderBy: { createdAt: 'asc' },
        take: 25,
        where: { kind: 'CRM', nextAttemptAt: { lte: now }, status: { in: ['PENDING', 'RETRY'] } },
      });
      for (const row of rows) await this.process(row.id);
    } finally {
      this.scanning = false;
    }
  }

  private async process(outboxRecordId: string): Promise<void> {
    const claimed = await this.database.client.outboxRecord.updateMany({
      data: {
        attempts: { increment: 1 },
        lastError: null,
        lockedAt: new Date(),
        lockedBy: 'crm-mock',
        status: 'PROCESSING',
      },
      where: { id: outboxRecordId, kind: 'CRM', status: { in: ['PENDING', 'RETRY'] } },
    });
    if (claimed.count !== 1) return;
    const operation = await this.database.client.crmOperation.findUnique({
      include: {
        contact: { select: { customFields: true, displayName: true, id: true } },
        normalizedEvent: { select: { payload: true } },
        project: { include: { crmConfig: true } },
      },
      where: { outboxRecordId },
    });
    if (!operation?.project.crmConfig?.enabled || !operation.contact) {
      await this.finish(outboxRecordId, 'FAILED', 'crm_mock_configuration_or_contact_missing');
      return;
    }
    const context = {
      correlationId: `crm-operation:${operation.id}`,
      crmProjectId: operation.project.crmConfig.crmProjectId,
      idempotencyKey: outboxRecordId,
      projectId: operation.projectId,
    };
    try {
      const result =
        operation.type === 'CREATE_OR_UPDATE_LEAD'
          ? await this.client.createOrUpdateLead(context, {
              contactId: operation.contact.id,
              displayName: operation.contact.displayName,
              fields: this.object(operation.contact.customFields),
            })
          : await this.client.forwardInboundMessage(context, {
              contactId: operation.contact.id,
              message: { type: 'telegram-inbound' },
              normalizedEventId: operation.normalizedEventId ?? operation.id,
            });
      await this.database.client.$transaction(async (transaction) => {
        await transaction.crmOperation.update({
          data: { resultSafe: { providerReference: result.providerReference } },
          where: { id: operation.id },
        });
        if (operation.type === 'CREATE_OR_UPDATE_LEAD')
          await transaction.contact.update({
            data: { crmLeadId: result.providerReference },
            where: { projectId_id: { id: operation.contactId!, projectId: operation.projectId } },
          });
        await transaction.outboxRecord.updateMany({
          data: {
            completedAt: new Date(),
            lastError: null,
            lockedAt: null,
            lockedBy: null,
            status: 'SUCCEEDED',
          },
          where: { id: outboxRecordId, lockedBy: 'crm-mock', status: 'PROCESSING' },
        });
      });
    } catch (error) {
      const outcome = error instanceof CrmMockError ? error.outcome : 'RETRYABLE_FAILURE';
      if (outcome === 'UNKNOWN') {
        await this.finish(outboxRecordId, 'UNKNOWN', 'crm_mock_unknown');
        return;
      }
      if (outcome === 'PERMANENT_FAILURE') {
        await this.finish(outboxRecordId, 'FAILED', 'crm_mock_permanent_failure');
        return;
      }
      const record = await this.database.client.outboxRecord.findUnique({
        where: { id: outboxRecordId },
      });
      if (!record || record.attempts >= record.maxAttempts) {
        await this.finish(outboxRecordId, 'FAILED', 'crm_mock_retry_exhausted');
        return;
      }
      await this.database.client.outboxRecord.updateMany({
        data: {
          lastError: 'crm_mock_retryable_failure',
          lockedAt: null,
          lockedBy: null,
          nextAttemptAt: new Date(Date.now() + Math.min(300_000, 1_000 * 2 ** record.attempts)),
          status: 'RETRY',
        },
        where: { id: outboxRecordId, lockedBy: 'crm-mock', status: 'PROCESSING' },
      });
      this.logger.warn({
        message: 'crm_mock_retry_scheduled',
        outboxRecordId,
        projectId: operation.projectId,
      });
    }
  }

  private async finish(
    outboxRecordId: string,
    status: 'FAILED' | 'UNKNOWN',
    error: string,
  ): Promise<void> {
    await this.database.client.outboxRecord.updateMany({
      data: {
        completedAt: new Date(),
        lastError: error,
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt: null,
        status,
      },
      where: { id: outboxRecordId, lockedBy: 'crm-mock', status: 'PROCESSING' },
    });
  }

  private object(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
