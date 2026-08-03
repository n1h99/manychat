import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiRequest, getUserErrorMessage, setUnauthorizedHandler } from './api';
import { selectApiBaseUrl } from './env';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

describe('authenticated API requests', () => {
  afterEach(() => {
    setUnauthorizedHandler(undefined);
    vi.unstubAllGlobals();
  });

  it('uses the browser origin for production API requests', () => {
    expect(
      selectApiBaseUrl('https://api-production.example', true, 'https://web-production.example'),
    ).toBe('https://web-production.example');
    expect(selectApiBaseUrl('http://localhost:3000', false, 'http://localhost:5173')).toBe(
      'http://localhost:3000',
    );
  });

  it('uses a bearer token without browser cookies', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: { permissions: ['channels:read'] }, meta: {} }, 200));

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      apiRequest<{ permissions: string[] }>(
        '/api/v1/projects/project-a/access',
        {},
        'expired-token',
      ),
    ).resolves.toEqual({ permissions: ['channels:read'] });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer expired-token',
    );
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe('omit');
  });

  it('clears persistent authentication on an unauthorized bearer response', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }, 401),
      );
    const unauthorized = vi.fn();

    vi.stubGlobal('fetch', fetchMock);
    setUnauthorizedHandler(unauthorized);

    await expect(
      apiRequest('/api/v1/projects/project-a', {}, 'expired-token'),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });

    expect(unauthorized).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('turns safe API codes and validation details into actionable user messages', () => {
    expect(
      getUserErrorMessage(
        new ApiError('USER_EMAIL_EXISTS', 'Conflict', 409),
        'The user account could not be saved.',
      ),
    ).toBe('The user account could not be saved. A user with this email already exists.');
    expect(
      getUserErrorMessage(
        new ApiError('VALIDATION_ERROR', 'Request validation failed', 400, 'correlation-a', {
          violations: ['description must be longer than or equal to 1 characters'],
        }),
        'The template could not be saved.',
      ),
    ).toBe('The template could not be saved. Review description.');
  });

  it('does not expose internal server messages and keeps a safe support reference', () => {
    expect(
      getUserErrorMessage(
        new ApiError('INTERNAL_ERROR', 'database connection string leaked', 500, 'correlation-a'),
        'The profile could not be saved.',
      ),
    ).toBe(
      'The profile could not be saved. The server could not complete the action. Reference: correlation-a.',
    );
  });
});
