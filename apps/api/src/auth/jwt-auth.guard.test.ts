import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { JwtAuthGuard } from './jwt-auth.guard';

function contextFor(authorization: string) {
  const request = { headers: { authorization } };
  return {
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
    },
    request,
  };
}

describe('JwtAuthGuard persistent sessions', () => {
  it('requires the JWT session ID to remain active', async () => {
    const access = {
      getGlobalAccess: vi
        .fn()
        .mockResolvedValue({ permissions: ['projects:read'], roleNames: ['super-admin'] }),
      isSessionActive: vi.fn().mockResolvedValue(true),
    };
    const jwt = {
      verifyAsync: vi.fn().mockResolvedValue({
        email: 'admin@example.test',
        sid: 'session-a',
        sub: 'user-a',
      }),
    };
    const guard = new JwtAuthGuard(
      access as never,
      { get: vi.fn().mockReturnValue('test-secret') } as never,
      jwt as never,
    );
    const { context, request } = contextFor('Bearer signed-token');

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(access.isSessionActive).toHaveBeenCalledWith('user-a', 'session-a');
    expect(request).toMatchObject({
      auth: { email: 'admin@example.test', userId: 'user-a' },
    });
  });

  it('rejects a bearer token whose session was revoked', async () => {
    const guard = new JwtAuthGuard(
      {
        getGlobalAccess: vi.fn(),
        isSessionActive: vi.fn().mockResolvedValue(false),
      } as never,
      { get: vi.fn().mockReturnValue('test-secret') } as never,
      {
        verifyAsync: vi.fn().mockResolvedValue({
          email: 'admin@example.test',
          sid: 'session-a',
          sub: 'user-a',
        }),
      } as never,
    );

    await expect(
      guard.canActivate(contextFor('Bearer revoked-token').context as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
