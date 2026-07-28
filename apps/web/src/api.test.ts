import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  apiRequest,
  clearPersistedCsrfToken,
  persistCsrfToken,
  setAccessTokenRefresher,
} from './api';
import { selectApiBaseUrl } from './env';

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

  it('uses the browser origin for production API requests', () => {
    expect(
      selectApiBaseUrl('https://api-production.example', true, 'https://web-production.example'),
    ).toBe('https://web-production.example');
    expect(selectApiBaseUrl('http://localhost:3000', false, 'http://localhost:5173')).toBe(
      'http://localhost:3000',
    );
  });

  it('persists and clears the CSRF token on the web origin', () => {
    const documentStub = { cookie: '' };
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('location', { protocol: 'https:' });

    persistCsrfToken('csrf-value', 2_592_000);
    expect(documentStub.cookie).toBe(
      'omnicus_csrf=csrf-value; Path=/; SameSite=Strict; Max-Age=2592000; Secure',
    );

    clearPersistedCsrfToken();
    expect(documentStub.cookie).toBe('omnicus_csrf=; Path=/; SameSite=Strict; Max-Age=0; Secure');
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
