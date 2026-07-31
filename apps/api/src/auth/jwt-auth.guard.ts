import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { ApiEnvironment } from '@omnicus/config/server';

import { AccessService } from '../access/access.service';
import type { AuthenticatedRequest } from './auth.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(ConfigService) private readonly config: ConfigService<ApiEnvironment, true>,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Authentication is required',
      });
    }
    try {
      const token = authorization.slice('Bearer '.length);
      const payload = await this.jwt.verifyAsync<{
        email?: unknown;
        sid?: unknown;
        sub?: unknown;
      }>(token, {
        algorithms: ['HS256'],
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      });
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.email !== 'string' ||
        typeof payload.sid !== 'string' ||
        !(await this.access.isSessionActive(payload.sub, payload.sid))
      ) {
        throw new Error('JWT subject is invalid');
      }
      const global = await this.access.getGlobalAccess(payload.sub);
      request.auth = {
        email: payload.email,
        globalPermissions: global.permissions,
        globalRoleNames: global.roleNames,
        sessionId: payload.sid,
        userId: payload.sub,
      };
      return true;
    } catch {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Access token is invalid' });
    }
  }
}
