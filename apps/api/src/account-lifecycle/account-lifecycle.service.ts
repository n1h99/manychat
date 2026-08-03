import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseCorsOrigins, type ApiEnvironment } from '@omnicus/config/server';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';

import { AuditService } from '../audit/audit.service';
import type { RequestSecurityContext } from '../auth/auth.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';
import type {
  AcceptInvitationDto,
  CreateGlobalInvitationDto,
  CreateProjectInvitationDto,
  ResetPasswordDto,
  TokenDto,
} from './dto';

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase('en-US');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function maskedEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 2)}${local.length > 2 ? '***' : '*'}@${domain}`;
}

@Injectable()
export class AccountLifecycleService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ConfigService) private readonly config: ConfigService<ApiEnvironment, true>,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async listGlobalInvitations() {
    return this.database.client.globalUserInviteToken.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        acceptedAt: true,
        createdAt: true,
        emailSnapshot: true,
        expiresAt: true,
        globalRole: { select: { id: true, name: true } },
        id: true,
        invitedByEmailSnapshot: true,
        revokedAt: true,
      },
      take: 100,
    });
  }

  async listProjectInvitations(projectId: string) {
    return this.database.client.projectUserInviteToken.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        acceptedAt: true,
        createdAt: true,
        emailSnapshot: true,
        expiresAt: true,
        id: true,
        invitedByEmailSnapshot: true,
        projectRole: { select: { id: true, name: true } },
        revokedAt: true,
      },
      take: 100,
      where: { projectId },
    });
  }

  async createGlobalInvitation(
    input: CreateGlobalInvitationDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const role = await this.database.client.globalRole.findUnique({
      where: { id: input.globalRoleId },
    });
    if (!role) throw new NotFoundException({ code: 'GLOBAL_ROLE_NOT_FOUND' });
    const normalizedEmail = normalizeEmail(input.email);
    const rawToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + input.expiresInHours * 60 * 60 * 1_000);
    const invitation = await this.database.client.$transaction(async (transaction) => {
      const reservation = await transaction.globalActiveInviteReservation.findUnique({
        include: { inviteToken: true },
        where: { normalizedEmail_globalRoleId: { globalRoleId: role.id, normalizedEmail } },
      });
      if (
        reservation &&
        !reservation.inviteToken.acceptedAt &&
        !reservation.inviteToken.revokedAt &&
        reservation.inviteToken.expiresAt > new Date()
      )
        throw new ConflictException({ code: 'INVITATION_ALREADY_ACTIVE' });
      if (reservation)
        await transaction.globalActiveInviteReservation.delete({
          where: { normalizedEmail_globalRoleId: { globalRoleId: role.id, normalizedEmail } },
        });
      const created = await transaction.globalUserInviteToken.create({
        data: {
          emailSnapshot: input.email.trim(),
          expiresAt,
          globalRoleId: role.id,
          invitedByEmailSnapshot: actor.email,
          invitedById: actor.userId,
          normalizedEmail,
          tokenHash: hashToken(rawToken),
        },
      });
      await transaction.globalActiveInviteReservation.create({
        data: { globalRoleId: role.id, inviteTokenId: created.id, normalizedEmail },
      });
      return created;
    });
    await this.audit.record({
      action: 'global.invitation.created',
      actorEmailSnapshot: actor.email,
      actorUserId: actor.userId,
      afterSafeJson: { email: invitation.emailSnapshot, expiresAt, roleId: role.id },
      correlationId: context.correlationId,
      entityId: invitation.id,
      entityType: 'GlobalUserInviteToken',
      ip: context.ip,
      userAgent: context.userAgent,
    });
    return {
      expiresAt,
      id: invitation.id,
      invitationUrl: `${this.webOrigin()}/accept-invitation#token=${encodeURIComponent(rawToken)}`,
    };
  }

  async createProjectInvitation(
    projectId: string,
    input: CreateProjectInvitationDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const role = await this.database.client.projectRole.findUnique({
      where: { projectId_id: { id: input.projectRoleId, projectId } },
    });
    if (!role) throw new NotFoundException({ code: 'PROJECT_ROLE_NOT_FOUND' });
    const normalizedEmail = normalizeEmail(input.email);
    const existingUser = await this.database.client.user.findUnique({ where: { normalizedEmail } });
    if (
      existingUser &&
      (await this.database.client.projectMembership.findUnique({
        where: { projectId_userId: { projectId, userId: existingUser.id } },
      }))
    )
      throw new ConflictException({ code: 'PROJECT_MEMBER_EXISTS' });
    const rawToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + input.expiresInHours * 60 * 60 * 1_000);
    const invitation = await this.database.client.$transaction(async (transaction) => {
      const reservation = await transaction.projectActiveInviteReservation.findUnique({
        include: { inviteToken: true },
        where: { projectId_normalizedEmail: { normalizedEmail, projectId } },
      });
      if (
        reservation &&
        !reservation.inviteToken.acceptedAt &&
        !reservation.inviteToken.revokedAt &&
        reservation.inviteToken.expiresAt > new Date()
      )
        throw new ConflictException({ code: 'INVITATION_ALREADY_ACTIVE' });
      if (reservation)
        await transaction.projectActiveInviteReservation.delete({
          where: { projectId_normalizedEmail: { normalizedEmail, projectId } },
        });
      const created = await transaction.projectUserInviteToken.create({
        data: {
          emailSnapshot: input.email.trim(),
          expiresAt,
          invitedByEmailSnapshot: actor.email,
          invitedById: actor.userId,
          normalizedEmail,
          projectId,
          projectRoleId: role.id,
          tokenHash: hashToken(rawToken),
        },
      });
      await transaction.projectActiveInviteReservation.create({
        data: { inviteTokenId: created.id, normalizedEmail, projectId },
      });
      return created;
    });
    await this.audit.record({
      action: 'project.invitation.created',
      actorEmailSnapshot: actor.email,
      actorUserId: actor.userId,
      afterSafeJson: { email: invitation.emailSnapshot, expiresAt, roleId: role.id },
      correlationId: context.correlationId,
      entityId: invitation.id,
      entityType: 'ProjectUserInviteToken',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
    return {
      expiresAt,
      id: invitation.id,
      invitationUrl: `${this.webOrigin()}/accept-invitation#token=${encodeURIComponent(rawToken)}`,
    };
  }

  async revokeGlobalInvitation(
    invitationId: string,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const invitation = await this.database.client.globalUserInviteToken.findUnique({
      where: { id: invitationId },
    });
    if (!invitation) throw new NotFoundException({ code: 'INVITATION_NOT_FOUND' });
    if (invitation.acceptedAt || invitation.revokedAt)
      throw new ConflictException({ code: 'INVITATION_NOT_ACTIVE' });
    await this.database.client.$transaction([
      this.database.client.globalUserInviteToken.update({
        data: { revokedAt: new Date() },
        where: { id: invitationId },
      }),
      this.database.client.globalActiveInviteReservation.deleteMany({
        where: { inviteTokenId: invitationId },
      }),
    ]);
    await this.audit.record({
      action: 'global.invitation.revoked',
      actorEmailSnapshot: actor.email,
      actorUserId: actor.userId,
      correlationId: context.correlationId,
      entityId: invitationId,
      entityType: 'GlobalUserInviteToken',
      ip: context.ip,
      userAgent: context.userAgent,
    });
  }

  async revokeProjectInvitation(
    projectId: string,
    invitationId: string,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const invitation = await this.database.client.projectUserInviteToken.findUnique({
      where: { projectId_id: { id: invitationId, projectId } },
    });
    if (!invitation) throw new NotFoundException({ code: 'INVITATION_NOT_FOUND' });
    if (invitation.acceptedAt || invitation.revokedAt)
      throw new ConflictException({ code: 'INVITATION_NOT_ACTIVE' });
    await this.database.client.$transaction([
      this.database.client.projectUserInviteToken.update({
        data: { revokedAt: new Date() },
        where: { id: invitationId },
      }),
      this.database.client.projectActiveInviteReservation.deleteMany({
        where: { inviteTokenId: invitationId, projectId },
      }),
    ]);
    await this.audit.record({
      action: 'project.invitation.revoked',
      actorEmailSnapshot: actor.email,
      actorUserId: actor.userId,
      correlationId: context.correlationId,
      entityId: invitationId,
      entityType: 'ProjectUserInviteToken',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
  }

  async previewInvitation(input: TokenDto) {
    const tokenHash = hashToken(input.token);
    const global = await this.database.client.globalUserInviteToken.findUnique({
      include: { globalRole: { select: { name: true } } },
      where: { tokenHash },
    });
    if (global) {
      this.assertActive(global);
      return {
        email: maskedEmail(global.emailSnapshot),
        expiresAt: global.expiresAt,
        roleName: global.globalRole.name,
        scope: 'GLOBAL' as const,
      };
    }
    const project = await this.database.client.projectUserInviteToken.findUnique({
      include: { project: { select: { name: true } }, projectRole: { select: { name: true } } },
      where: { tokenHash },
    });
    if (!project) throw new NotFoundException({ code: 'INVITATION_INVALID' });
    this.assertActive(project);
    return {
      email: maskedEmail(project.emailSnapshot),
      expiresAt: project.expiresAt,
      projectName: project.project.name,
      roleName: project.projectRole.name,
      scope: 'PROJECT' as const,
    };
  }

  async acceptInvitation(input: AcceptInvitationDto, context: RequestSecurityContext) {
    const tokenHash = hashToken(input.token);
    const global = await this.database.client.globalUserInviteToken.findUnique({
      where: { tokenHash },
    });
    if (global) {
      this.assertActive(global);
      const userPlan = await this.prepareInviteUser(
        global.normalizedEmail,
        global.emailSnapshot,
        input,
      );
      const user = await this.database.client.$transaction(async (transaction) => {
        const consumed = await transaction.globalUserInviteToken.updateMany({
          data: { acceptedAt: new Date() },
          where: {
            acceptedAt: null,
            expiresAt: { gt: new Date() },
            id: global.id,
            revokedAt: null,
          },
        });
        if (consumed.count !== 1) throw new ConflictException({ code: 'INVITATION_NOT_ACTIVE' });
        await transaction.globalActiveInviteReservation.deleteMany({
          where: { inviteTokenId: global.id },
        });
        const acceptedUser = userPlan.userId
          ? { email: userPlan.email, id: userPlan.userId }
          : await transaction.user.create({ data: userPlan.create! });
        await transaction.globalUserRole.upsert({
          create: { globalRoleId: global.globalRoleId, userId: acceptedUser.id },
          update: {},
          where: {
            userId_globalRoleId: {
              globalRoleId: global.globalRoleId,
              userId: acceptedUser.id,
            },
          },
        });
        return acceptedUser;
      });
      await this.auditAccepted(global.id, undefined, user.id, user.email, context);
      return { scope: 'GLOBAL' as const };
    }
    const project = await this.database.client.projectUserInviteToken.findUnique({
      where: { tokenHash },
    });
    if (!project) throw new NotFoundException({ code: 'INVITATION_INVALID' });
    this.assertActive(project);
    const userPlan = await this.prepareInviteUser(
      project.normalizedEmail,
      project.emailSnapshot,
      input,
    );
    const user = await this.database.client.$transaction(async (transaction) => {
      const consumed = await transaction.projectUserInviteToken.updateMany({
        data: { acceptedAt: new Date() },
        where: {
          acceptedAt: null,
          expiresAt: { gt: new Date() },
          id: project.id,
          projectId: project.projectId,
          revokedAt: null,
        },
      });
      if (consumed.count !== 1) throw new ConflictException({ code: 'INVITATION_NOT_ACTIVE' });
      await transaction.projectActiveInviteReservation.deleteMany({
        where: { inviteTokenId: project.id, projectId: project.projectId },
      });
      const acceptedUser = userPlan.userId
        ? { email: userPlan.email, id: userPlan.userId }
        : await transaction.user.create({ data: userPlan.create! });
      await transaction.projectMembership.upsert({
        create: {
          projectId: project.projectId,
          projectRoleId: project.projectRoleId,
          userId: acceptedUser.id,
        },
        update: { projectRoleId: project.projectRoleId, status: 'ACTIVE' },
        where: {
          projectId_userId: { projectId: project.projectId, userId: acceptedUser.id },
        },
      });
      return acceptedUser;
    });
    await this.auditAccepted(project.id, project.projectId, user.id, user.email, context);
    return { projectId: project.projectId, scope: 'PROJECT' as const };
  }

  async requestPasswordReset(email: string, context: RequestSecurityContext) {
    const user = await this.database.client.user.findUnique({
      where: { normalizedEmail: normalizeEmail(email) },
    });
    const recentRequest = await this.database.client.auditLog.findFirst({
      select: { id: true },
      where: {
        action: 'auth.password_reset.requested',
        createdAt: { gte: new Date(Date.now() - 15 * 60 * 1_000) },
        entityId: user?.id ?? '__unknown_account__',
      },
    });
    if (user?.status === 'ACTIVE' && !recentRequest)
      await this.audit.record({
        action: 'auth.password_reset.requested',
        actorEmailSnapshot: user.email,
        actorType: 'ANONYMOUS',
        correlationId: context.correlationId,
        entityId: user.id,
        entityType: 'User',
        ip: context.ip,
        userAgent: context.userAgent,
      });
    return { accepted: true };
  }

  async createPasswordResetLink(
    userId: string,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const user = await this.database.client.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND' });
    const token = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1_000);
    const reset = await this.database.client.$transaction(async (transaction) => {
      await transaction.passwordResetToken.updateMany({
        data: { usedAt: new Date() },
        where: { expiresAt: { gt: new Date() }, usedAt: null, userId },
      });
      return transaction.passwordResetToken.create({
        data: {
          expiresAt,
          ...(context.ip === undefined ? {} : { ip: context.ip }),
          tokenHash: hashToken(token),
          userId,
        },
      });
    });
    await this.audit.record({
      action: 'auth.password_reset.link_created',
      actorEmailSnapshot: actor.email,
      actorUserId: actor.userId,
      afterSafeJson: { expiresAt },
      correlationId: context.correlationId,
      entityId: userId,
      entityType: 'User',
      ip: context.ip,
      userAgent: context.userAgent,
    });
    return {
      expiresAt,
      id: reset.id,
      resetUrl: `${this.webOrigin()}/reset-password#token=${encodeURIComponent(token)}`,
    };
  }

  async previewPasswordReset(input: TokenDto) {
    const reset = await this.database.client.passwordResetToken.findUnique({
      include: { user: { select: { email: true, status: true } } },
      where: { tokenHash: hashToken(input.token) },
    });
    if (!reset || reset.usedAt || reset.expiresAt <= new Date() || reset.user.status !== 'ACTIVE')
      throw new NotFoundException({ code: 'PASSWORD_RESET_INVALID' });
    return { email: maskedEmail(reset.user.email), expiresAt: reset.expiresAt };
  }

  async resetPassword(input: ResetPasswordDto, context: RequestSecurityContext) {
    const tokenHash = hashToken(input.token);
    const reset = await this.database.client.passwordResetToken.findUnique({
      include: { user: true },
      where: { tokenHash },
    });
    if (!reset || reset.usedAt || reset.expiresAt <= new Date() || reset.user.status !== 'ACTIVE')
      throw new NotFoundException({ code: 'PASSWORD_RESET_INVALID' });
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    await this.database.client.$transaction(async (transaction) => {
      const consumed = await transaction.passwordResetToken.updateMany({
        data: { usedAt: new Date() },
        where: { expiresAt: { gt: new Date() }, id: reset.id, usedAt: null },
      });
      if (consumed.count !== 1) throw new ConflictException({ code: 'PASSWORD_RESET_INVALID' });
      await transaction.user.update({ data: { passwordHash }, where: { id: reset.userId } });
      await transaction.session.updateMany({
        data: { revokedAt: new Date(), status: 'REVOKED' },
        where: { status: 'ACTIVE', userId: reset.userId },
      });
    });
    await this.audit.record({
      action: 'auth.password_reset.completed',
      actorEmailSnapshot: reset.user.email,
      actorType: 'ANONYMOUS',
      correlationId: context.correlationId,
      entityId: reset.userId,
      entityType: 'User',
      ip: context.ip,
      userAgent: context.userAgent,
    });
    return { completed: true };
  }

  private async prepareInviteUser(
    normalizedEmail: string,
    email: string,
    input: AcceptInvitationDto,
  ): Promise<{
    create?: {
      email: string;
      firstName: string;
      lastName: string;
      normalizedEmail: string;
      passwordHash: string;
    };
    email: string;
    userId?: string;
  }> {
    const existing = await this.database.client.user.findUnique({ where: { normalizedEmail } });
    if (existing) {
      if (
        existing.status !== 'ACTIVE' ||
        !(await argon2.verify(existing.passwordHash, input.password))
      )
        throw new UnauthorizedException({ code: 'INVITATION_ACCOUNT_AUTH_FAILED' });
      return { email: existing.email, userId: existing.id };
    }
    if (!input.firstName || !input.lastName)
      throw new ConflictException({ code: 'INVITATION_PROFILE_REQUIRED' });
    return {
      create: {
        email,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        normalizedEmail,
        passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }),
      },
      email,
    };
  }

  private assertActive(invitation: {
    acceptedAt: Date | null;
    expiresAt: Date;
    revokedAt: Date | null;
  }) {
    if (invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date())
      throw new ConflictException({ code: 'INVITATION_NOT_ACTIVE' });
  }

  private async auditAccepted(
    invitationId: string,
    projectId: string | undefined,
    userId: string,
    email: string,
    context: RequestSecurityContext,
  ) {
    await this.audit.record({
      action: 'invitation.accepted',
      actorEmailSnapshot: email,
      actorType: 'INVITED_USER',
      actorUserId: userId,
      correlationId: context.correlationId,
      entityId: invitationId,
      entityType: 'Invitation',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
  }

  private webOrigin(): string {
    return (
      parseCorsOrigins(this.config.get('CORS_ALLOWED_ORIGINS', { infer: true }))[0] ??
      'http://localhost:5173'
    );
  }
}
