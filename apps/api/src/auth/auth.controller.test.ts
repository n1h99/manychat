import { describe, expect, it, vi } from 'vitest';

import { AuthController } from './auth.controller';

describe('AuthController session cookies', () => {
  it('returns the CSRF token so a cross-origin SPA can persist the double-submit token', async () => {
    const controller = new AuthController(
      {
        login: vi.fn().mockResolvedValue({
          identity: { email: 'admin@example.test' },
          tokens: { accessToken: 'access', csrfToken: 'csrf', refreshToken: 'refresh' },
        }),
      } as never,
      { get: vi.fn().mockReturnValue('development') } as never,
    );
    const response = { clearCookie: vi.fn(), cookie: vi.fn() };

    const result = await controller.login(
      { email: 'admin@example.test', password: 'not-a-real-password' },
      { headers: {} } as never,
      response as never,
    );

    expect(result.data).toEqual({
      accessToken: 'access',
      csrfToken: 'csrf',
      user: { email: 'admin@example.test' },
    });
    expect(response.clearCookie).toHaveBeenCalledWith('omnicus_csrf', {
      path: '/api/v1/auth',
      sameSite: 'strict',
    });
    expect(response.cookie).toHaveBeenCalledTimes(1);
    expect(response.cookie).toHaveBeenCalledWith(
      'omnicus_refresh',
      'refresh',
      expect.objectContaining({ httpOnly: true, sameSite: 'strict', secure: false }),
    );
  });

  it('uses a Secure cross-site refresh cookie and accepts only an allowlisted web origin', async () => {
    const refresh = vi.fn().mockResolvedValue({
      identity: { email: 'admin@example.test' },
      tokens: { accessToken: 'access-2', csrfToken: 'csrf-2', refreshToken: 'refresh-2' },
    });
    const controller = new AuthController(
      { refresh } as never,
      {
        get: vi.fn((key: string) => {
          if (key === 'APP_ENV') return 'production';
          if (key === 'CORS_ALLOWED_ORIGINS') return 'https://app.example.test';
          if (key === 'REFRESH_TOKEN_TTL_DAYS') return 30;
          return undefined;
        }),
      } as never,
    );
    const response = { clearCookie: vi.fn(), cookie: vi.fn() };

    await controller.refresh(
      {
        headers: {
          cookie: 'omnicus_refresh=refresh',
          origin: 'https://app.example.test',
          'x-csrf-token': 'csrf',
        },
      } as never,
      response as never,
    );

    expect(refresh).toHaveBeenCalledOnce();
    expect(response.cookie).toHaveBeenCalledWith(
      'omnicus_refresh',
      'refresh-2',
      expect.objectContaining({ httpOnly: true, sameSite: 'none', secure: true }),
    );
  });

  it('rejects refresh from an origin outside the configured CORS allowlist', async () => {
    const refresh = vi.fn();
    const controller = new AuthController(
      { refresh } as never,
      {
        get: vi.fn((key: string) =>
          key === 'CORS_ALLOWED_ORIGINS' ? 'https://app.example.test' : 'production',
        ),
      } as never,
    );

    await expect(
      controller.refresh(
        {
          headers: {
            cookie: 'omnicus_refresh=refresh',
            origin: 'https://attacker.example',
            'x-csrf-token': 'csrf',
          },
        } as never,
        { clearCookie: vi.fn(), cookie: vi.fn() } as never,
      ),
    ).rejects.toMatchObject({
      response: { code: 'CSRF_ORIGIN_REJECTED' },
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
