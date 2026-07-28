import { timingSafeEqual } from 'node:crypto';

import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@omnicus/config/server';
import type { Request } from 'express';

@Injectable()
export class CrmIntegrationAuthGuard implements CanActivate {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<ApiEnvironment, true>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.get('CRM_INBOUND_ENABLED', { infer: true }))
      throw new ServiceUnavailableException({
        code: 'CRM_INBOUND_DISABLED',
        message: 'CRM inbound integration is disabled',
      });
    const expected = this.config.get('CRM_INBOUND_AUTH_TOKEN', { infer: true });
    const authorization = context.switchToHttp().getRequest<Request>().headers.authorization;
    const received =
      typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : undefined;
    if (!expected || !received || !this.matches(expected, received))
      throw new UnauthorizedException({
        code: 'CRM_AUTHENTICATION_FAILED',
        message: 'Service authentication failed',
      });
    return true;
  }

  private matches(expected: string, received: string): boolean {
    const expectedBytes = Buffer.from(expected);
    const receivedBytes = Buffer.from(received);
    return (
      expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)
    );
  }
}
