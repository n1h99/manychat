import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service';

const context = { correlationId: 'test-request', ip: '127.0.0.1' };

function createService(client: Record<string, unknown>) {
  return new AuthService(
    { record: vi.fn() } as never,
    { client } as never,
    {
      get: (key: string) =>
        ({
          JWT_ACCESS_SECRET: 'test-only-jwt-secret-that-is-long-enough-for-validation',
          JWT_ACCESS_TTL_SECONDS: 900,
          REFRESH_TOKEN_TTL_DAYS: 30,
        })[key],
    } as never,
    { signAsync: vi.fn().mockResolvedValue('access-token') } as never,
    { assertAllowed: vi.fn(), clear: vi.fn() } as never,
  );
}

describe('AuthService', () => {
  it('creates a session for valid credentials and rejects disabled users', async () => {
    const passwordHash = await argon2.hash('correct-password', { type: argon2.argon2id });
    const user = {
      email: 'admin@example.test',
      firstName: 'Admin',
      id: 'user-a',
      lastName: 'User',
      normalizedEmail: 'admin@example.test',
      passwordHash,
      status: 'ACTIVE',
    };
    const client = {
      globalUserRole: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ globalRole: { normalizedName: 'super-admin', permissions: [] } }]),
      },
      session: { create: vi.fn() },
      user: { findUnique: vi.fn().mockResolvedValue(user), update: vi.fn() },
    };
    const service = createService(client);
    await expect(service.login(user.email, 'correct-password', context)).resolves.toMatchObject({
      tokens: { accessToken: 'access-token' },
    });
    client.user.findUnique.mockResolvedValueOnce({ ...user, status: 'DISABLED' });
    await expect(service.login(user.email, 'correct-password', context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('treats a rotated refresh token as reuse and revokes its family', async () => {
    const client = {
      session: {
        findUnique: vi.fn().mockResolvedValue({
          csrfTokenHash: '7ce12ba8782a32f74357cefb81edb8c20ea4d755115ecb4063348b8cc9d41f34',
          status: 'ROTATED',
          tokenFamilyId: 'family-a',
          userId: 'user-a',
        }),
        updateMany: vi.fn(),
      },
    };
    const audit = { record: vi.fn() };
    const service = new AuthService(
      audit as never,
      { client } as never,
      { get: () => 30 } as never,
      { signAsync: vi.fn() } as never,
      { assertAllowed: vi.fn(), clear: vi.fn() } as never,
    );
    await expect(service.refresh('reused-refresh', 'csrf', context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(client.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenFamilyId: 'family-a', userId: 'user-a' } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.refresh.reuse_detected' }),
    );
  });
});
