import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { RequestSecurityContext } from '../auth/auth.service';
import { DatabaseService } from '../database/database.service';
import type { AddMemberDto, UpdateMembershipDto } from './dto';

@Injectable()
export class MembersService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async list(projectId: string) {
    return this.database.client.projectMembership.findMany({
      include: {
        projectRole: { select: { id: true, name: true, normalizedName: true } },
        user: { select: { email: true, firstName: true, id: true, lastName: true, status: true } },
      },
      orderBy: { createdAt: 'asc' },
      where: { projectId },
    });
  }

  async add(
    projectId: string,
    input: AddMemberDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    await this.assertProjectRole(projectId, input.projectRoleId);
    const user = await this.database.client.user.findUnique({ where: { id: input.userId } });
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User was not found' });
    }
    const existing = await this.database.client.projectMembership.findUnique({
      where: { projectId_userId: { projectId, userId: input.userId } },
    });
    if (existing) {
      throw new ConflictException({
        code: 'MEMBERSHIP_EXISTS',
        message: 'Project membership already exists',
      });
    }
    const membership = await this.database.client.projectMembership.create({
      data: {
        createdById: actor.userId,
        projectId,
        projectRoleId: input.projectRoleId,
        userId: input.userId,
      },
      include: {
        projectRole: true,
        user: { select: { email: true, firstName: true, id: true, lastName: true } },
      },
    });
    await this.audit.record({
      action: 'project.membership.added',
      actorEmailSnapshot: actor.email,
      actorUserId: actor.userId,
      afterSafeJson: { projectRoleId: membership.projectRoleId, userId: membership.userId },
      correlationId: context.correlationId,
      entityId: membership.id,
      entityType: 'ProjectMembership',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
    return membership;
  }

  async update(
    projectId: string,
    membershipId: string,
    input: UpdateMembershipDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const membership = await this.requireMembership(projectId, membershipId);
    await this.assertProjectRole(projectId, input.projectRoleId);
    await this.assertNotRemovingLastAdmin(projectId, membership.projectRoleId, input.projectRoleId);
    const updated = await this.database.client.projectMembership.update({
      data: { projectRoleId: input.projectRoleId },
      include: {
        projectRole: true,
        user: { select: { email: true, firstName: true, id: true, lastName: true } },
      },
      where: { id: membershipId },
    });
    await this.audit.record({
      action: 'project.membership.changed',
      actorEmailSnapshot: actor.email,
      actorUserId: actor.userId,
      afterSafeJson: { projectRoleId: updated.projectRoleId },
      beforeSafeJson: { projectRoleId: membership.projectRoleId },
      correlationId: context.correlationId,
      entityId: membershipId,
      entityType: 'ProjectMembership',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
    return updated;
  }

  async remove(
    projectId: string,
    membershipId: string,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ): Promise<void> {
    const membership = await this.requireMembership(projectId, membershipId);
    await this.assertNotRemovingLastAdmin(projectId, membership.projectRoleId, undefined);
    await this.database.client.projectMembership.delete({ where: { id: membershipId } });
    await this.audit.record({
      action: 'project.membership.deleted',
      actorEmailSnapshot: actor.email,
      actorUserId: actor.userId,
      beforeSafeJson: { projectRoleId: membership.projectRoleId, userId: membership.userId },
      correlationId: context.correlationId,
      entityId: membershipId,
      entityType: 'ProjectMembership',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
  }

  private async assertProjectRole(projectId: string, projectRoleId: string): Promise<void> {
    const role = await this.database.client.projectRole.findUnique({
      where: { projectId_id: { id: projectRoleId, projectId } },
    });
    if (!role) {
      throw new NotFoundException({
        code: 'PROJECT_ROLE_NOT_FOUND',
        message: 'Project role was not found',
      });
    }
  }

  private async assertNotRemovingLastAdmin(
    projectId: string,
    currentRoleId: string,
    nextRoleId: string | undefined,
  ): Promise<void> {
    const currentRole = await this.database.client.projectRole.findUnique({
      where: { projectId_id: { id: currentRoleId, projectId } },
    });
    if (currentRole?.normalizedName !== 'project-admin') {
      return;
    }
    const nextRole = nextRoleId
      ? await this.database.client.projectRole.findUnique({
          where: { projectId_id: { id: nextRoleId, projectId } },
        })
      : undefined;
    if (nextRole?.normalizedName === 'project-admin') {
      return;
    }
    const adminCount = await this.database.client.projectMembership.count({
      where: { projectId, projectRole: { normalizedName: 'project-admin' }, status: 'ACTIVE' },
    });
    if (adminCount <= 1) {
      throw new ConflictException({
        code: 'LAST_PROJECT_ADMIN',
        message: 'The last Project Admin cannot be removed',
      });
    }
  }

  private async requireMembership(projectId: string, membershipId: string) {
    const membership = await this.database.client.projectMembership.findUnique({
      where: { id: membershipId },
    });
    if (!membership || membership.projectId !== projectId) {
      throw new NotFoundException({
        code: 'MEMBERSHIP_NOT_FOUND',
        message: 'Project membership was not found',
      });
    }
    return membership;
  }
}
