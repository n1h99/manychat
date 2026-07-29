import { createHash } from 'node:crypto';

import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { CrmIntegrationAuthGuard } from './crm-integration-auth.guard';

function context(authorization?: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  };
}

describe('CrmIntegrationAuthGuard', () => {
  const database = {
    client: { crmProjectConfig: { findUnique: vi.fn().mockResolvedValue(null) } },
  };

  it('fails closed while the inbound integration is disabled', async () => {
    const guard = new CrmIntegrationAuthGuard(
      {
        get: vi.fn((key: string) => key !== 'CRM_INBOUND_ENABLED' && 'unused'),
      } as never,
      database as never,
    );

    await expect(guard.canActivate(context() as never)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('rejects absent and incorrect service credentials', async () => {
    const guard = new CrmIntegrationAuthGuard(
      {
        get: vi.fn((key: string) =>
          key === 'CRM_INBOUND_ENABLED' ? true : 'expected-service-token-that-is-long-enough',
        ),
      } as never,
      database as never,
    );

    await expect(guard.canActivate(context() as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      guard.canActivate(context('Bearer incorrect-service-token-that-is-long-enough') as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts the dedicated CRM inbound credential', async () => {
    const token = 'expected-service-token-that-is-long-enough';
    const guard = new CrmIntegrationAuthGuard(
      {
        get: vi.fn((key: string) => (key === 'CRM_INBOUND_ENABLED' ? true : token)),
      } as never,
      database as never,
    );

    await expect(guard.canActivate(context(`Bearer ${token}`) as never)).resolves.toBe(true);
  });

  it('accepts a project-scoped hashed credential without exposing it on the request', async () => {
    const token = 'project-scoped-service-token-that-is-long-enough';
    const request = { headers: { authorization: `Bearer ${token}` } };
    const scopedDatabase = {
      client: {
        crmProjectConfig: {
          findUnique: vi.fn().mockResolvedValue({
            enabled: true,
            id: 'config-a',
            projectId: 'project-a',
            status: 'ACTIVE',
          }),
        },
      },
    };
    const guard = new CrmIntegrationAuthGuard(
      {
        get: vi.fn((key: string) => (key === 'CRM_INBOUND_ENABLED' ? true : undefined)),
      } as never,
      scopedDatabase as never,
    );

    await expect(
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => request }),
      } as never),
    ).resolves.toBe(true);
    expect(scopedDatabase.client.crmProjectConfig.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          inboundTokenHash: createHash('sha256').update(token).digest('hex'),
        },
      }),
    );
    expect(request).toHaveProperty(
      'crmIntegration',
      expect.objectContaining({ legacy: false, projectId: 'project-a' }),
    );
    expect(
      JSON.stringify((request as typeof request & { crmIntegration: unknown }).crmIntegration),
    ).not.toContain(token);
  });
});
