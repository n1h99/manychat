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
  it('fails closed while the inbound integration is disabled', () => {
    const guard = new CrmIntegrationAuthGuard({
      get: vi.fn((key: string) => key !== 'CRM_INBOUND_ENABLED' && 'unused'),
    } as never);

    expect(() => guard.canActivate(context() as never)).toThrow(ServiceUnavailableException);
  });

  it('rejects absent and incorrect service credentials', () => {
    const guard = new CrmIntegrationAuthGuard({
      get: vi.fn((key: string) =>
        key === 'CRM_INBOUND_ENABLED' ? true : 'expected-service-token-that-is-long-enough',
      ),
    } as never);

    expect(() => guard.canActivate(context() as never)).toThrow(UnauthorizedException);
    expect(() =>
      guard.canActivate(context('Bearer incorrect-service-token-that-is-long-enough') as never),
    ).toThrow(UnauthorizedException);
  });

  it('accepts the dedicated CRM inbound credential', () => {
    const token = 'expected-service-token-that-is-long-enough';
    const guard = new CrmIntegrationAuthGuard({
      get: vi.fn((key: string) => (key === 'CRM_INBOUND_ENABLED' ? true : token)),
    } as never);

    expect(guard.canActivate(context(`Bearer ${token}`) as never)).toBe(true);
  });
});
