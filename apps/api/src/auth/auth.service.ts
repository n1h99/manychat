import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { ApiEnvironment } from '@omnicus/config/server';
import { TokenStatus, UserStatus } from '@omnicus/database';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import type { AuthenticatedUser } from './auth.types';
import { LoginRateLimitService } from './login-rate-limit.service';

export interface RequestSecurityContext {
  correlationId: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface SessionTokens {
  accessToken: string;
  csrfToken: string;
  refreshToken: string;
}

export interface AuthIdentity extends AuthenticatedUser {
  firstName: string;
  lastName: string;
  status: UserStatus;
}

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase('en-US');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ConfigService) private readonly config: ConfigService<ApiEnvironment, true>,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(LoginRateLimitService) private readonly loginRateLimit: LoginRateLimitService,
  ) {}

  async login(
    email: string,
    password: string,
    context: RequestSecurityContext,
  ): Promise<{
    identity: AuthIdentity;
    tokens: SessionTokens;
  }> {
    const normalizedEmail = normalizeEmail(email);
    await this.loginRateLimit.assertAllowed(`${context.ip ?? 'unknown'}:${normalizedEmail}`);
    const user = await this.database.client.user.findUnique({
      where: { normalizedEmail },
    });
    const validPassword = user ? await argon2.verify(user.passwordHash, password) : false;
    if (!user || !validPassword || user.status !== UserStatus.ACTIVE) {
      await this.audit.record({
        action: 'auth.login.failed',
        actorEmailSnapshot: normalizedEmail,
        actorType: 'ANONYMOUS',
        correlationId: context.correlationId,
        entityType: 'Session',
        ip: context.ip,
        reason: !user || !validPassword ? 'INVALID_CREDENTIALS' : 'USER_DISABLED',
        userAgent: context.userAgent,
      });
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      });
    }
    await this.loginRateLimit.clear(`${context.ip ?? 'unknown'}:${normalizedEmail}`);
    const identity = await this.identityForUser(user.id);
    const tokens = await this.createSession(identity, context);
    await this.database.client.user.update({
      data: { lastLoginAt: new Date() },
      where: { id: user.id },
    });
    await this.audit.record({
      action: 'auth.login.succeeded',
      actorEmailSnapshot: user.email,
      actorUserId: user.id,
      correlationId: context.correlationId,
      entityId: user.id,
      entityType: 'Session',
      ip: context.ip,
      userAgent: context.userAgent,
    });
    return { identity, tokens };
  }

  async refresh(
    refreshToken: string | undefined,
    csrfToken: string | undefined,
    context: RequestSecurityContext,
  ): Promise<{ identity: AuthIdentity; tokens: SessionTokens }> {
    if (!refreshToken || !csrfToken) {
      throw new UnauthorizedException({
        code: 'REFRESH_REQUIRED',
        message: 'Refresh session is required',
      });
    }
    const refreshTokenHash = sha256(refreshToken);
    const session = await this.database.client.session.findUnique({
      include: { user: true },
      where: { refreshTokenHash },
    });
    if (!session || !constantTimeEquals(session.csrfTokenHash, sha256(csrfToken))) {
      throw new UnauthorizedException({
        code: 'REFRESH_INVALID',
        message: 'Refresh session is invalid',
      });
    }
    if (
      session.status !== TokenStatus.ACTIVE ||
      session.expiresAt <= new Date() ||
      session.user.status !== UserStatus.ACTIVE
    ) {
      if (session.status === TokenStatus.ROTATED) {
        await this.markFamilyReused(session.tokenFamilyId, session.userId, context);
      } else if (session.status === TokenStatus.ACTIVE && session.expiresAt <= new Date()) {
        await this.database.client.session.update({
          data: { status: TokenStatus.EXPIRED },
          where: { id: session.id },
        });
      }
      throw new UnauthorizedException({
        code: 'REFRESH_INVALID',
        message: 'Refresh session is invalid',
      });
    }
    const identity = await this.identityForUser(session.userId);
    const tokens = this.newOpaqueTokens();
    const replacementId = randomUUID();
    const expiresAt = this.refreshExpiry();
    const rotated = await this.database.client.$transaction(async (transaction) => {
      const rotation = await transaction.session.updateMany({
        data: {
          replacedBySessionId: replacementId,
          rotatedAt: new Date(),
          status: TokenStatus.ROTATED,
        },
        where: { id: session.id, status: TokenStatus.ACTIVE },
      });
      if (rotation.count !== 1) {
        return false;
      }
      await transaction.session.create({
        data: {
          csrfTokenHash: sha256(tokens.csrfToken),
          expiresAt,
          id: replacementId,
          ...(context.ip === undefined ? {} : { ip: context.ip }),
          refreshTokenHash: sha256(tokens.refreshToken),
          tokenFamilyId: session.tokenFamilyId,
          ...(context.userAgent === undefined ? {} : { userAgent: context.userAgent }),
          userId: session.userId,
        },
      });
      return true;
    });
    if (!rotated) {
      await this.markFamilyReused(session.tokenFamilyId, session.userId, context);
      throw new UnauthorizedException({
        code: 'REFRESH_INVALID',
        message: 'Refresh session is invalid',
      });
    }
    tokens.accessToken = await this.signAccessToken(identity);
    return { identity, tokens };
  }

  async logout(
    refreshToken: string | undefined,
    csrfToken: string | undefined,
    context: RequestSecurityContext,
  ): Promise<void> {
    if (!refreshToken || !csrfToken) {
      throw new UnauthorizedException({
        code: 'REFRESH_REQUIRED',
        message: 'Refresh session is required',
      });
    }
    const session = await this.database.client.session.findUnique({
      where: { refreshTokenHash: sha256(refreshToken) },
    });
    if (!session || !constantTimeEquals(session.csrfTokenHash, sha256(csrfToken))) {
      throw new UnauthorizedException({
        code: 'REFRESH_INVALID',
        message: 'Refresh session is invalid',
      });
    }
    await this.database.client.session.update({
      data: { revokedAt: new Date(), status: TokenStatus.REVOKED },
      where: { id: session.id },
    });
    await this.audit.record({
      action: 'auth.logout',
      actorUserId: session.userId,
      correlationId: context.correlationId,
      entityId: session.id,
      entityType: 'Session',
      ip: context.ip,
      userAgent: context.userAgent,
    });
  }

  async logoutAll(auth: AuthenticatedUser, context: RequestSecurityContext): Promise<void> {
    await this.revokeAllSessions(auth.userId);
    await this.audit.record({
      action: 'auth.logout_all',
      actorEmailSnapshot: auth.email,
      actorUserId: auth.userId,
      correlationId: context.correlationId,
      entityId: auth.userId,
      entityType: 'User',
      ip: context.ip,
      userAgent: context.userAgent,
    });
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.database.client.session.updateMany({
      data: { revokedAt: new Date(), status: TokenStatus.REVOKED },
      where: { status: TokenStatus.ACTIVE, userId },
    });
  }

  async me(auth: AuthenticatedUser): Promise<AuthIdentity> {
    return this.identityForUser(auth.userId);
  }

  private async createSession(
    identity: AuthIdentity,
    context: RequestSecurityContext,
  ): Promise<SessionTokens> {
    const tokens = this.newOpaqueTokens();
    await this.database.client.session.create({
      data: {
        csrfTokenHash: sha256(tokens.csrfToken),
        expiresAt: this.refreshExpiry(),
        ...(context.ip === undefined ? {} : { ip: context.ip }),
        refreshTokenHash: sha256(tokens.refreshToken),
        tokenFamilyId: randomUUID(),
        ...(context.userAgent === undefined ? {} : { userAgent: context.userAgent }),
        userId: identity.userId,
      },
    });
    tokens.accessToken = await this.signAccessToken(identity);
    return tokens;
  }

  private async identityForUser(userId: string): Promise<AuthIdentity> {
    const user = await this.database.client.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException({ code: 'USER_DISABLED', message: 'User is disabled' });
    }
    const roles = await this.database.client.globalUserRole.findMany({
      include: { globalRole: { include: { permissions: { include: { permission: true } } } } },
      where: { userId },
    });
    return {
      email: user.email,
      firstName: user.firstName,
      globalPermissions: [
        ...new Set(
          roles.flatMap((assignment) =>
            assignment.globalRole.permissions.map((entry) => entry.permission.code),
          ),
        ),
      ],
      globalRoleNames: roles.map((assignment) => assignment.globalRole.normalizedName),
      lastName: user.lastName,
      status: user.status,
      userId: user.id,
    };
  }

  private async markFamilyReused(
    familyId: string,
    userId: string,
    context: RequestSecurityContext,
  ): Promise<void> {
    await this.database.client.session.updateMany({
      data: { reuseDetectedAt: new Date(), revokedAt: new Date(), status: TokenStatus.REUSED },
      where: { tokenFamilyId: familyId, userId },
    });
    await this.audit.record({
      action: 'auth.refresh.reuse_detected',
      actorUserId: userId,
      correlationId: context.correlationId,
      entityId: familyId,
      entityType: 'SessionFamily',
      ip: context.ip,
      userAgent: context.userAgent,
    });
  }

  private newOpaqueTokens(): SessionTokens {
    return {
      accessToken: '',
      csrfToken: randomBytes(32).toString('base64url'),
      refreshToken: randomBytes(48).toString('base64url'),
    };
  }

  private refreshExpiry(): Date {
    return new Date(
      Date.now() +
        this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 24 * 60 * 60 * 1_000,
    );
  }

  private async signAccessToken(identity: AuthIdentity): Promise<string> {
    return this.jwt.signAsync(
      { email: identity.email, sub: identity.userId },
      {
        algorithm: 'HS256',
        expiresIn: this.config.get('JWT_ACCESS_TTL_SECONDS', { infer: true }),
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      },
    );
  }
}
