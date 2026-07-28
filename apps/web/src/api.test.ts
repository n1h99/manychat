import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiRequest, setUnauthorizedHandler } from './api';
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
});
