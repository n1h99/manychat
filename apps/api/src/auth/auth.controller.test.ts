import { describe, expect, it, vi } from 'vitest';

import { AuthController } from './auth.controller';

describe('AuthController session cookies', () => {
  it('makes the CSRF cookie readable from protected SPA routes', async () => {
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

    await controller.login(
      { email: 'admin@example.test', password: 'not-a-real-password' },
      { headers: {} } as never,
      response as never,
    );

    expect(response.clearCookie).toHaveBeenCalledWith('omnicus_csrf', {
      path: '/api/v1/auth',
      sameSite: 'strict',
    });
    expect(response.cookie).toHaveBeenCalledWith(
      'omnicus_csrf',
      'csrf',
      expect.objectContaining({ httpOnly: false, path: '/', sameSite: 'strict' }),
    );
  });
});
