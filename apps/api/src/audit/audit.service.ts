import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@omnicus/database';

import { DatabaseService } from '../database/database.service';

export interface AuditEvent {
  action: string;
  actorEmailSnapshot?: string | undefined;
  actorType?: string | undefined;
  actorUserId?: string | undefined;
  afterSafeJson?: Prisma.InputJsonValue | undefined;
  beforeSafeJson?: Prisma.InputJsonValue | undefined;
  correlationId: string;
  entityId?: string | undefined;
  entityType: string;
  ip?: string | undefined;
  projectId?: string | undefined;
  reason?: string | undefined;
  userAgent?: string | undefined;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async record(event: AuditEvent): Promise<void> {
    const project = event.projectId
      ? await this.database.client.project.findUnique({
          select: { name: true, slug: true },
          where: { id: event.projectId },
        })
      : null;
    const data = {
      action: event.action,
      actorEmailSnapshot: event.actorEmailSnapshot ?? null,
      actorType: event.actorType ?? 'USER',
      actorUserId: event.actorUserId ?? null,
      afterSafeJson: event.afterSafeJson ?? Prisma.JsonNull,
      beforeSafeJson: event.beforeSafeJson ?? Prisma.JsonNull,
      correlationId: event.correlationId,
      entityId: event.entityId ?? null,
      entityType: event.entityType,
      ip: event.ip ?? null,
      projectId: event.projectId ?? null,
      projectNameSnapshot: event.projectId === undefined ? null : (project?.name ?? null),
      projectSlugSnapshot: event.projectId === undefined ? null : (project?.slug ?? null),
      purgeAfter: new Date(Date.now() + 180 * 24 * 60 * 60 * 1_000),
      reason: event.reason ?? null,
      userAgent: event.userAgent ?? null,
    } satisfies Prisma.AuditLogUncheckedCreateInput;
    await this.database.client.auditLog.create({
      data,
    });
  }
}
