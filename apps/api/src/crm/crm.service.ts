import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@omnicus/database';

import type { AuthenticatedUser } from '../auth/auth.types';
import type { RequestSecurityContext } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import type { UpsertCrmProjectConfigDto } from './dto';

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

  private json(value: Record<string, unknown>): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
