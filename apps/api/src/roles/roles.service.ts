import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@omnicus/database';

import { globalPermissions } from '../access/permissions';
import { AuditService } from '../audit/audit.service';
import type { RequestSecurityContext } from '../auth/auth.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';
import type { CreateGlobalRoleDto, UpdateGlobalRoleDto } from './dto';

function normalized(name: string): string {
  return name
    .trim()
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');
}

@Injectable()
export class RolesService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  list() {
    return this.database.client.globalRole.findMany({
      orderBy: [{ system: 'desc' }, { name: 'asc' }],
      select: {
        _count: { select: { userRoles: true } },
        id: true,
        name: true,
        normalizedName: true,
        permissions: { select: { permission: { select: { code: true, description: true } } } },
        system: true,
        updatedAt: true,
      },
    });
  }

  permissions() {
    return this.database.client.permission.findMany({
      orderBy: { code: 'asc' },
      select: { code: true, description: true },
      where: { code: { in: [...globalPermissions] } },
    });
  }

  async create(
    input: CreateGlobalRoleDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const normalizedName = normalized(input.name);
    if (!normalizedName) throw new ConflictException({ code: 'ROLE_NAME_INVALID' });
    if (await this.database.client.globalRole.findUnique({ where: { normalizedName } }))
      throw new ConflictException({ code: 'ROLE_NAME_EXISTS' });
    const permissionIds = await this.permissionIds(input.permissionCodes);
    const role = await this.database.client.$transaction(async (transaction) => {
      const created = await transaction.globalRole.create({
        data: { name: input.name.trim(), normalizedName, system: false },
      });
      if (permissionIds.length)
        await transaction.globalRolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ globalRoleId: created.id, permissionId })),
        });
      return created;
    });
    await this.auditRole('global.role.created', role.id, actor, context, {
      name: role.name,
      permissionCodes: [...new Set(input.permissionCodes)].sort(),
    });
    return this.get(role.id);
  }

  async update(
    roleId: string,
    input: UpdateGlobalRoleDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const before = await this.requireMutable(roleId);
    const normalizedName = input.name === undefined ? undefined : normalized(input.name);
    if (input.name !== undefined && !normalizedName)
      throw new ConflictException({ code: 'ROLE_NAME_INVALID' });
    if (normalizedName && normalizedName !== before.normalizedName) {
      if (await this.database.client.globalRole.findUnique({ where: { normalizedName } }))
        throw new ConflictException({ code: 'ROLE_NAME_EXISTS' });
    }
    const permissionIds =
      input.permissionCodes === undefined
        ? undefined
        : await this.permissionIds(input.permissionCodes);
    await this.database.client.$transaction(async (transaction) => {
      await transaction.globalRole.update({
        data:
          input.name === undefined
            ? {}
            : { name: input.name.trim(), normalizedName: normalizedName! },
        where: { id: roleId },
      });
      if (permissionIds) {
        await transaction.globalRolePermission.deleteMany({ where: { globalRoleId: roleId } });
        if (permissionIds.length)
          await transaction.globalRolePermission.createMany({
            data: permissionIds.map((permissionId) => ({ globalRoleId: roleId, permissionId })),
          });
      }
    });
    await this.auditRole('global.role.updated', roleId, actor, context, {
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.permissionCodes === undefined
        ? {}
        : { permissionCodes: [...new Set(input.permissionCodes)].sort() }),
    });
    return this.get(roleId);
  }

  async remove(roleId: string, actor: AuthenticatedUser, context: RequestSecurityContext) {
    const role = await this.requireMutable(roleId);
    const assignments = await this.database.client.globalUserRole.count({
      where: { globalRoleId: roleId },
    });
    if (assignments > 0) throw new ConflictException({ code: 'ROLE_IN_USE' });
    await this.database.client.globalRole.delete({ where: { id: roleId } });
    await this.auditRole('global.role.deleted', roleId, actor, context, { name: role.name });
  }

  private get(roleId: string) {
    return this.database.client.globalRole.findUnique({
      select: {
        _count: { select: { userRoles: true } },
        id: true,
        name: true,
        normalizedName: true,
        permissions: { select: { permission: { select: { code: true, description: true } } } },
        system: true,
        updatedAt: true,
      },
      where: { id: roleId },
    });
  }

  private async requireMutable(roleId: string) {
    const role = await this.database.client.globalRole.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException({ code: 'GLOBAL_ROLE_NOT_FOUND' });
    if (role.system) throw new ConflictException({ code: 'SYSTEM_ROLE_IMMUTABLE' });
    return role;
  }

  private async permissionIds(codes: string[]) {
    const uniqueCodes = [...new Set(codes)];
    const permissions = await this.database.client.permission.findMany({
      select: { id: true },
      where: {
        code: { in: uniqueCodes.filter((code) => globalPermissions.includes(code as never)) },
      },
    });
    if (permissions.length !== uniqueCodes.length)
      throw new NotFoundException({ code: 'ROLE_PERMISSION_NOT_FOUND' });
    return permissions.map((permission) => permission.id);
  }

  private async auditRole(
    action: string,
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
      entityType: 'GlobalRole',
      ip: context.ip,
      userAgent: context.userAgent,
    });
  }
}
