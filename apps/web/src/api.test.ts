import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiRequest, setAccessTokenRefresher } from './api';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

describe('authenticated API requests', () => {
  afterEach(() => {
    setAccessTokenRefresher(undefined);
    vi.unstubAllGlobals();
  });

  it('refreshes an expired access token and retries the original request once', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }, 401),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: { permissions: ['channels:read'] }, meta: {} }, 200),
      );
    const refresh = vi.fn().mockResolvedValue('fresh-access-token');

    vi.stubGlobal('fetch', fetchMock);
    setAccessTokenRefresher(refresh);

    await expect(
      apiRequest<{ permissions: string[] }>(
        '/api/v1/projects/project-a/access',
        {},
        'expired-token',
      ),
    ).resolves.toEqual({ permissions: ['channels:read'] });

    expect(refresh).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer expired-token',
    );
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('authorization')).toBe(
      'Bearer fresh-access-token',
    );
  });

  it('does not loop when the retried request is still unauthorized', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }, 401),
      );
    const refresh = vi.fn().mockResolvedValue('fresh-access-token');

    vi.stubGlobal('fetch', fetchMock);
    setAccessTokenRefresher(refresh);

    await expect(
      apiRequest('/api/v1/projects/project-a', {}, 'expired-token'),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });

    expect(refresh).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
