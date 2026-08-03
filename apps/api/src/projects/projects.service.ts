import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@omnicus/database';

import { AccessService } from '../access/access.service';
import { SUPER_ADMIN_ROLE } from '../access/permissions';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { RequestSecurityContext } from '../auth/auth.service';
import type { CloneProjectDto, CreateProjectDto, UpdateProjectDto } from './dto';
import { ProjectRolesService } from './project-roles.service';

const projectSelection = {
  createdAt: true,
  description: true,
  id: true,
  locale: true,
  name: true,
  settings: true,
  slug: true,
  status: true,
  timezone: true,
  updatedAt: true,
} as const;

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ProjectRolesService) private readonly roles: ProjectRolesService,
  ) {}

  async list(auth: AuthenticatedUser) {
    const superAdmin = auth.globalRoleNames.includes(SUPER_ADMIN_ROLE);
    const where: Prisma.ProjectWhereInput = {
      status: { not: 'ARCHIVED' },
      ...(superAdmin ? {} : { memberships: { some: { status: 'ACTIVE', userId: auth.userId } } }),
    };
    return this.database.client.project.findMany({
      orderBy: { createdAt: 'desc' },
      select: projectSelection,
      where,
    });
  }

  async get(projectId: string, auth: AuthenticatedUser) {
    await this.assertProjectRead(projectId, auth);
    const project = await this.database.client.project.findUnique({
      select: projectSelection,
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: 'Project was not found' });
    }
    return project;
  }

  async getAccess(projectId: string, auth: AuthenticatedUser) {
    await this.assertProjectRead(projectId, auth);
    return this.access.getProjectAccess(auth.userId, projectId);
  }

  async listRoles(projectId: string, auth: AuthenticatedUser) {
    await this.assertProjectRead(projectId, auth);
    return this.roles.list(projectId);
  }

  async clone(
    sourceProjectId: string,
    input: CloneProjectDto,
    auth: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const source = await this.get(sourceProjectId, auth);
    const existing = await this.database.client.project.findUnique({ where: { slug: input.slug } });
    if (existing) throw new ConflictException({ code: 'PROJECT_SLUG_EXISTS' });
    const customRoles = await this.database.client.projectRole.findMany({
      include: { permissions: { select: { permissionId: true } } },
      where: { projectId: sourceProjectId, system: false },
    });
    return this.database.client.$transaction(async (transaction) => {
      const project = await transaction.project.create({
        data: {
          description: source.description,
          locale: source.locale,
          name: input.name.trim(),
          settings: source.settings as Prisma.InputJsonValue,
          slug: input.slug,
          status: 'DRAFT',
          timezone: source.timezone,
        },
        select: projectSelection,
      });
      const roles = await this.roles.ensureForProject(project.id, transaction);
      for (const role of customRoles) {
        const cloned = await transaction.projectRole.create({
          data: {
            name: role.name,
            normalizedName: role.normalizedName,
            projectId: project.id,
            system: false,
          },
        });
        if (role.permissions.length)
          await transaction.projectRolePermission.createMany({
            data: role.permissions.map(({ permissionId }) => ({
              permissionId,
              projectId: project.id,
              projectRoleId: cloned.id,
            })),
          });
      }
      const projectAdminRoleId = roles.get('project-admin');
      if (!projectAdminRoleId) throw new Error('Project Admin system role was not created');
      await transaction.projectMembership.create({
        data: {
          createdById: auth.userId,
          projectId: project.id,
          projectRoleId: projectAdminRoleId,
          userId: auth.userId,
        },
      });
      await transaction.auditLog.create({
        data: {
          action: 'project.cloned',
          actorEmailSnapshot: auth.email,
          actorType: 'USER',
          actorUserId: auth.userId,
          afterSafeJson: { name: project.name, slug: project.slug, sourceProjectId },
          correlationId: context.correlationId,
          entityId: project.id,
          entityType: 'Project',
          ip: context.ip ?? null,
          projectId: project.id,
          projectNameSnapshot: project.name,
          projectSlugSnapshot: project.slug,
          purgeAfter: new Date(Date.now() + 180 * 24 * 60 * 60 * 1_000),
          userAgent: context.userAgent ?? null,
        },
      });
      return project;
    });
  }

  async create(input: CreateProjectDto, auth: AuthenticatedUser, context: RequestSecurityContext) {
    const existing = await this.database.client.project.findUnique({ where: { slug: input.slug } });
    if (existing) {
      throw new ConflictException({
        code: 'PROJECT_SLUG_EXISTS',
        message: 'Project slug is already in use',
      });
    }
    return this.database.client.$transaction(async (transaction) => {
      const project = await transaction.project.create({
        data: {
          description: input.description ?? null,
          locale: input.locale,
          name: input.name,
          settings: (input.settings ?? {}) as Prisma.InputJsonValue,
          slug: input.slug,
          timezone: input.timezone,
        },
        select: projectSelection,
      });
      const roles = await this.roles.ensureForProject(project.id, transaction);
      const projectAdminRoleId = roles.get('project-admin');
      if (!projectAdminRoleId) {
        throw new Error('Project Admin system role was not created');
      }
      await transaction.projectMembership.create({
        data: {
          createdById: auth.userId,
          projectId: project.id,
          projectRoleId: projectAdminRoleId,
          userId: auth.userId,
        },
      });
      await transaction.auditLog.create({
        data: {
          action: 'project.created',
          actorEmailSnapshot: auth.email,
          actorType: 'USER',
          actorUserId: auth.userId,
          afterSafeJson: { name: project.name, slug: project.slug, status: project.status },
          correlationId: context.correlationId,
          entityId: project.id,
          entityType: 'Project',
          ip: context.ip ?? null,
          projectId: project.id,
          projectNameSnapshot: project.name,
          projectSlugSnapshot: project.slug,
          purgeAfter: new Date(Date.now() + 180 * 24 * 60 * 60 * 1_000),
          userAgent: context.userAgent ?? null,
        },
      });
      return project;
    });
  }

  async update(
    projectId: string,
    input: UpdateProjectDto,
    auth: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const before = await this.get(projectId, auth);
    const project = await this.database.client.project.update({
      data: {
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.locale === undefined ? {} : { locale: input.locale }),
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.settings === undefined
          ? {}
          : { settings: input.settings as Prisma.InputJsonValue }),
        ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
      },
      select: projectSelection,
      where: { id: projectId },
    });
    await this.audit.record({
      action: 'project.updated',
      actorEmailSnapshot: auth.email,
      actorUserId: auth.userId,
      afterSafeJson: { name: project.name, status: project.status },
      beforeSafeJson: { name: before.name, status: before.status },
      correlationId: context.correlationId,
      entityId: project.id,
      entityType: 'Project',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
    return project;
  }

  async setStatus(
    projectId: string,
    status: 'ACTIVE' | 'PAUSED',
    auth: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const before = await this.get(projectId, auth);
    const project = await this.database.client.project.update({
      data: { status },
      select: projectSelection,
      where: { id: projectId },
    });
    await this.audit.record({
      action: status === 'ACTIVE' ? 'project.activated' : 'project.paused',
      actorEmailSnapshot: auth.email,
      actorUserId: auth.userId,
      afterSafeJson: { status: project.status },
      beforeSafeJson: { status: before.status },
      correlationId: context.correlationId,
      entityId: project.id,
      entityType: 'Project',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
    return project;
  }

  async archive(projectId: string, auth: AuthenticatedUser, context: RequestSecurityContext) {
    const before = await this.get(projectId, auth);
    const project = await this.database.client.project.update({
      data: { status: 'ARCHIVED' },
      select: projectSelection,
      where: { id: projectId },
    });
    await this.audit.record({
      action: 'project.archived',
      actorEmailSnapshot: auth.email,
      actorUserId: auth.userId,
      afterSafeJson: { status: project.status },
      beforeSafeJson: { status: before.status },
      correlationId: context.correlationId,
      entityId: project.id,
      entityType: 'Project',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
    return project;
  }

  async assertProjectRead(projectId: string, auth: AuthenticatedUser): Promise<void> {
    if (auth.globalRoleNames.includes(SUPER_ADMIN_ROLE)) {
      return;
    }
    if (!(await this.access.hasProjectPermission(auth.userId, projectId, 'project:read'))) {
      throw new ForbiddenException({
        code: 'PROJECT_ACCESS_DENIED',
        message: 'Project access is denied',
      });
    }
  }
}
