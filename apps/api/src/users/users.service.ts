import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@omnicus/database';
import * as argon2 from 'argon2';

import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { type RequestSecurityContext } from '../auth/auth.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';
import type { CreateUserDto, UpdateUserDto } from './dto';

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase('en-US');
}

const userSelection = {
  city: true,
  country: true,
  createdAt: true,
  email: true,
  firstName: true,
  id: true,
  lastName: true,
  region: true,
  status: true,
  updatedAt: true,
} as const;

function optionalProfileField(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async list() {
    return this.database.client.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        ...userSelection,
        globalRoles: {
          select: { globalRole: { select: { id: true, name: true, normalizedName: true } } },
        },
      },
    });
  }

  async listGlobalRoles() {
    return this.database.client.globalRole.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, normalizedName: true, system: true },
    });
  }

  async create(input: CreateUserDto, actor: AuthenticatedUser, context: RequestSecurityContext) {
    const normalizedEmail = normalizeEmail(input.email);
    const existing = await this.database.client.user.findUnique({ where: { normalizedEmail } });
    if (existing) {
      throw new ConflictException({
        code: 'USER_EMAIL_EXISTS',
        message: 'User email is already in use',
      });
    }
    const passwordHash = await argon2.hash(input.temporaryPassword, { type: argon2.argon2id });
    const user = await this.database.client.$transaction(async (transaction) => {
      const created = await transaction.user.create({
        data: {
          email: input.email.trim(),
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          ...(input.country === undefined ? {} : { country: optionalProfileField(input.country) }),
          ...(input.region === undefined ? {} : { region: optionalProfileField(input.region) }),
          ...(input.city === undefined ? {} : { city: optionalProfileField(input.city) }),
          normalizedEmail,
          passwordHash,
        },
        select: userSelection,
      });
      await this.replaceGlobalRoles(
        created.id,
        input.globalRoleIds ?? [],
        actor.userId,
        transaction,
      );
      return created;
    });
    await this.audit.record({
      action: 'user.created',
      actorEmailSnapshot: actor.email,
      actorUserId: actor.userId,
      afterSafeJson: { email: user.email, status: user.status },
      correlationId: context.correlationId,
      entityId: user.id,
      entityType: 'User',
      ip: context.ip,
      userAgent: context.userAgent,
    });
    return user;
  }

  async update(
    userId: string,
    input: UpdateUserDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
    preserveSessionId?: string,
  ) {
    const before = await this.requireUser(userId);
    const normalizedEmail = input.email === undefined ? undefined : normalizeEmail(input.email);
    if (normalizedEmail !== undefined && normalizedEmail !== normalizeEmail(before.email)) {
      const existing = await this.database.client.user.findUnique({ where: { normalizedEmail } });
      if (existing) {
        throw new ConflictException({
          code: 'USER_EMAIL_EXISTS',
          message: 'User email is already in use',
        });
      }
    }
    const passwordHash =
      input.newPassword === undefined
        ? undefined
        : await argon2.hash(input.newPassword, { type: argon2.argon2id });
    const user = await this.database.client.$transaction(async (transaction) => {
      const updated = await transaction.user.update({
        data: {
          ...(input.email === undefined
            ? {}
            : { email: input.email.trim(), normalizedEmail: normalizeEmail(input.email) }),
          ...(input.firstName === undefined ? {} : { firstName: input.firstName.trim() }),
          ...(input.lastName === undefined ? {} : { lastName: input.lastName.trim() }),
          ...(input.country === undefined ? {} : { country: optionalProfileField(input.country) }),
          ...(input.region === undefined ? {} : { region: optionalProfileField(input.region) }),
          ...(input.city === undefined ? {} : { city: optionalProfileField(input.city) }),
          ...(passwordHash === undefined ? {} : { passwordHash }),
        },
        select: userSelection,
        where: { id: userId },
      });
      if (input.globalRoleIds !== undefined) {
        await this.replaceGlobalRoles(userId, input.globalRoleIds, actor.userId, transaction);
      }
      if (passwordHash !== undefined) {
        await transaction.session.updateMany({
          data: { revokedAt: new Date(), status: 'REVOKED' },
          where: {
            ...(preserveSessionId === undefined ? {} : { id: { not: preserveSessionId } }),
            status: 'ACTIVE',
            userId,
          },
        });
      }
      return updated;
    });
    await this.audit.record({
      action: input.globalRoleIds === undefined ? 'user.updated' : 'user.global_roles.changed',
      actorEmailSnapshot: actor.email,
      actorUserId: actor.userId,
      afterSafeJson: {
        city: user.city,
        country: user.country,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        region: user.region,
      },
      beforeSafeJson: {
        city: before.city,
        country: before.country,
        email: before.email,
        firstName: before.firstName,
        lastName: before.lastName,
        region: before.region,
      },
      correlationId: context.correlationId,
      entityId: user.id,
      entityType: 'User',
      ip: context.ip,
      userAgent: context.userAgent,
    });
    if (passwordHash !== undefined) {
      await this.audit.record({
        action: 'user.password.changed',
        actorEmailSnapshot: actor.email,
        actorUserId: actor.userId,
        correlationId: context.correlationId,
        entityId: user.id,
        entityType: 'User',
        ip: context.ip,
        userAgent: context.userAgent,
      });
    }
    return user;
  }

  async disable(userId: string, actor: AuthenticatedUser, context: RequestSecurityContext) {
    const user = await this.requireUser(userId);
    await this.database.client.$transaction(async (transaction) => {
      await transaction.user.update({ data: { status: 'DISABLED' }, where: { id: userId } });
      await transaction.session.updateMany({
        data: { revokedAt: new Date(), status: 'REVOKED' },
        where: { status: 'ACTIVE', userId },
      });
    });
    await this.audit.record({
      action: 'user.disabled',
      actorEmailSnapshot: actor.email,
      actorUserId: actor.userId,
      beforeSafeJson: { status: user.status },
      correlationId: context.correlationId,
      entityId: userId,
      entityType: 'User',
      ip: context.ip,
      userAgent: context.userAgent,
    });
  }

  async revokeSessions(userId: string, actor: AuthenticatedUser, context: RequestSecurityContext) {
    await this.requireUser(userId);
    await this.auth.revokeAllSessions(userId);
    await this.audit.record({
      action: 'user.sessions_revoked',
      actorEmailSnapshot: actor.email,
      actorUserId: actor.userId,
      correlationId: context.correlationId,
      entityId: userId,
      entityType: 'User',
      ip: context.ip,
      userAgent: context.userAgent,
    });
  }

  async profile(userId: string) {
    return this.requireUser(userId);
  }

  private async requireUser(userId: string) {
    const user = await this.database.client.user.findUnique({
      select: userSelection,
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User was not found' });
    }
    return user;
  }

  private async replaceGlobalRoles(
    userId: string,
    globalRoleIds: string[],
    createdById: string,
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    const uniqueIds = [...new Set(globalRoleIds)];
    const roles = await transaction.globalRole.findMany({ where: { id: { in: uniqueIds } } });
    if (roles.length !== uniqueIds.length) {
      throw new NotFoundException({
        code: 'GLOBAL_ROLE_NOT_FOUND',
        message: 'Global role was not found',
      });
    }
    await transaction.globalUserRole.deleteMany({ where: { userId } });
    if (uniqueIds.length > 0) {
      await transaction.globalUserRole.createMany({
        data: uniqueIds.map((globalRoleId) => ({ createdById, globalRoleId, userId })),
      });
    }
  }
}
