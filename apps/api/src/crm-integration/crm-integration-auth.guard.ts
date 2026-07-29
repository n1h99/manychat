import { createHash, timingSafeEqual } from 'node:crypto';

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

import { DatabaseService } from '../database/database.service';

export interface AuthenticatedCrmIntegrationRequest extends Request {
  crmIntegration?: {
    configId: string;
    legacy: boolean;
    projectId?: string;
  };
}

@Injectable()
export class CrmIntegrationAuthGuard implements CanActivate {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<ApiEnvironment, true>,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.config.get('CRM_INBOUND_ENABLED', { infer: true }))
      throw new ServiceUnavailableException({
        code: 'CRM_INBOUND_DISABLED',
        message: 'CRM inbound integration is disabled',
      });
    const request = context.switchToHttp().getRequest<AuthenticatedCrmIntegrationRequest>();
    const authorization = request.headers.authorization;
    const received =
      typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : undefined;
    if (!received) this.unauthorized();

    const connection = await this.database.client.crmProjectConfig.findUnique({
      select: { enabled: true, id: true, projectId: true, status: true },
      where: { inboundTokenHash: this.hash(received!) },
    });
    if (connection?.enabled && connection.status === 'ACTIVE') {
      request.crmIntegration = {
        configId: connection.id,
        legacy: false,
        projectId: connection.projectId,
      };
      return true;
    }

    const legacy = this.config.get('CRM_INBOUND_AUTH_TOKEN', { infer: true });
    if (legacy && this.matches(legacy, received!)) {
      request.crmIntegration = { configId: 'legacy-environment', legacy: true };
      return true;
    }
    this.unauthorized();
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private matches(expected: string, received: string): boolean {
    const expectedBytes = Buffer.from(expected);
    const receivedBytes = Buffer.from(received);
    return (
      expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)
    );
  }

  private unauthorized(): never {
    throw new UnauthorizedException({
      code: 'CRM_AUTHENTICATION_FAILED',
      message: 'Service authentication failed',
    });
  }
}
