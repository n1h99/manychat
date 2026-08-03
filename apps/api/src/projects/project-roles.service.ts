import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@omnicus/database';

import type { AuthenticatedUser } from '../auth/auth.types';
import type { RequestSecurityContext } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { systemProjectRoles } from '../access/permissions';
import { DatabaseService } from '../database/database.service';
import type { CreateProjectRoleDto, UpdateProjectRoleDto } from './dto';

function normalizeRoleName(name: string): string {
  return name
    .trim()
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');
}

@Injectable()
export class ProjectRolesService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async list(projectId: string) {
    return this.database.client.projectRole.findMany({
      orderBy: [{ system: 'desc' }, { name: 'asc' }],
      select: {
        _count: { select: { memberships: true } },
        id: true,
        name: true,
        normalizedName: true,
        permissions: { select: { permission: { select: { code: true, description: true } } } },
        system: true,
        updatedAt: true,
      },
      where: { projectId },
    });
  }

  async permissions() {
    return this.database.client.permission.findMany({
      orderBy: { code: 'asc' },
      select: { code: true, description: true },
      where: {
        code: { contains: ':' },
        NOT: {
          code: {
            in: ['projects:create', 'projects:read', 'users:manage', 'users:read', 'roles:manage'],
          },
        },
      },
    });
  }

  async create(
    projectId: string,
    input: CreateProjectRoleDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const normalizedName = normalizeRoleName(input.name);
    if (!normalizedName) throw new ConflictException({ code: 'ROLE_NAME_INVALID' });
    const existing = await this.database.client.projectRole.findUnique({
      where: { projectId_normalizedName: { normalizedName, projectId } },
    });
    if (existing) throw new ConflictException({ code: 'ROLE_NAME_EXISTS' });
    const permissionIds = await this.permissionIds(input.permissionCodes);
    const role = await this.database.client.$transaction(async (transaction) => {
      const created = await transaction.projectRole.create({
        data: { name: input.name.trim(), normalizedName, projectId, system: false },
      });
      if (permissionIds.length)
        await transaction.projectRolePermission.createMany({
          data: permissionIds.map((permissionId) => ({
            permissionId,
            projectId,
            projectRoleId: created.id,
          })),
        });
      return created;
    });
    await this.auditRole('project.role.created', projectId, role.id, actor, context, {
      name: role.name,
      permissionCodes: [...new Set(input.permissionCodes)].sort(),
    });
    return this.get(projectId, role.id);
  }

  async update(
    projectId: string,
    roleId: string,
    input: UpdateProjectRoleDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const before = await this.requireMutable(projectId, roleId);
    const normalizedName = input.name === undefined ? undefined : normalizeRoleName(input.name);
    if (input.name !== undefined && !normalizedName)
      throw new ConflictException({ code: 'ROLE_NAME_INVALID' });
    if (normalizedName && normalizedName !== before.normalizedName) {
      const existing = await this.database.client.projectRole.findUnique({
        where: { projectId_normalizedName: { normalizedName, projectId } },
      });
      if (existing) throw new ConflictException({ code: 'ROLE_NAME_EXISTS' });
    }
    const permissionIds =
      input.permissionCodes === undefined
        ? undefined
        : await this.permissionIds(input.permissionCodes);
    await this.database.client.$transaction(async (transaction) => {
      await transaction.projectRole.update({
        data: {
          ...(input.name === undefined
            ? {}
            : { name: input.name.trim(), normalizedName: normalizedName! }),
        },
        where: { projectId_id: { id: roleId, projectId } },
      });
      if (permissionIds) {
        await transaction.projectRolePermission.deleteMany({
          where: { projectId, projectRoleId: roleId },
        });
        if (permissionIds.length)
          await transaction.projectRolePermission.createMany({
            data: permissionIds.map((permissionId) => ({
              permissionId,
              projectId,
              projectRoleId: roleId,
            })),
          });
      }
    });
    await this.auditRole('project.role.updated', projectId, roleId, actor, context, {
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.permissionCodes === undefined
        ? {}
        : { permissionCodes: [...new Set(input.permissionCodes)].sort() }),
    });
    return this.get(projectId, roleId);
  }

  async remove(
    projectId: string,
    roleId: string,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ): Promise<void> {
    const role = await this.requireMutable(projectId, roleId);
    const activeReferences = await this.database.client.projectMembership.count({
      where: { projectId, projectRoleId: roleId },
    });
    if (activeReferences > 0) throw new ConflictException({ code: 'ROLE_IN_USE' });
    await this.database.client.projectRole.delete({
      where: { projectId_id: { id: roleId, projectId } },
    });
    await this.auditRole('project.role.deleted', projectId, roleId, actor, context, {
      name: role.name,
    });
  }

  async ensureForProject(
    projectId: string,
    transaction: Prisma.TransactionClient = this.database.client,
  ): Promise<Map<string, string>> {
    const permissions = await transaction.permission.findMany({
      where: { code: { in: systemProjectRoles.flatMap((role) => [...role.permissions]) } },
    });
    const permissionIds = new Map(
      permissions.map((permission) => [permission.code, permission.id]),
    );
    const roles = new Map<string, string>();
    for (const definition of systemProjectRoles) {
      const role = await transaction.projectRole.upsert({
        create: {
          name: definition.name,
          normalizedName: definition.normalizedName,
          projectId,
          system: true,
        },
        update: { name: definition.name, system: true },
        where: {
          projectId_normalizedName: { normalizedName: definition.normalizedName, projectId },
        },
      });
      for (const permissionCode of definition.permissions) {
        const permissionId = permissionIds.get(permissionCode);
        if (!permissionId) {
          throw new Error(`Required system permission is missing: ${permissionCode}`);
        }
        await transaction.projectRolePermission.upsert({
          create: { permissionId, projectId, projectRoleId: role.id },
          update: {},
          where: {
            projectId_projectRoleId_permissionId: {
              permissionId,
              projectId,
              projectRoleId: role.id,
            },
          },
        });
      }
      roles.set(definition.normalizedName, role.id);
    }
    return roles;
  }

  private get(projectId: string, roleId: string) {
    return this.database.client.projectRole.findUnique({
      select: {
        _count: { select: { memberships: true } },
        id: true,
        name: true,
        normalizedName: true,
        permissions: { select: { permission: { select: { code: true, description: true } } } },
        system: true,
        updatedAt: true,
      },
      where: { projectId_id: { id: roleId, projectId } },
    });
  }

  private async requireMutable(projectId: string, roleId: string) {
    const role = await this.database.client.projectRole.findUnique({
      where: { projectId_id: { id: roleId, projectId } },
    });
    if (!role) throw new NotFoundException({ code: 'PROJECT_ROLE_NOT_FOUND' });
    if (role.system) throw new ConflictException({ code: 'SYSTEM_ROLE_IMMUTABLE' });
    return role;
  }

  private async permissionIds(permissionCodes: string[]): Promise<string[]> {
    const uniqueCodes = [...new Set(permissionCodes)];
    const permissions = await this.database.client.permission.findMany({
      select: { id: true },
      where: {
        code: { in: uniqueCodes },
        NOT: {
          code: {
            in: ['projects:create', 'projects:read', 'users:manage', 'users:read', 'roles:manage'],
          },
        },
      },
    });
    if (permissions.length !== uniqueCodes.length)
      throw new NotFoundException({ code: 'ROLE_PERMISSION_NOT_FOUND' });
    return permissions.map((permission) => permission.id);
  }

  private async auditRole(
    action: string,
    projectId: string,
    roleId: string,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
    afterSafeJson: Prisma.InputJsonValue,
  ) {
    await this.audit.record({
      action,
      actorEmailSnapshot: actor.email,
      actorUserId: actor.userId,
      afterSafeJson,
      correlationId: context.correlationId,
      entityId: roleId,
      entityType: 'ProjectRole',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
  }
}
