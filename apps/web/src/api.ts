import { readApiBaseUrl } from './env';

export interface ApiEnvelope<T> {
  data: T;
  meta: Record<string, never>;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

type AccessTokenRefresher = () => Promise<string | undefined>;

let accessTokenRefresher: AccessTokenRefresher | undefined;
let pendingAccessTokenRefresh: Promise<string | undefined> | undefined;
const csrfCookieName = 'omnicus_csrf';

export function setAccessTokenRefresher(refresher: AccessTokenRefresher | undefined): void {
  accessTokenRefresher = refresher;
  pendingAccessTokenRefresh = undefined;
}

async function refreshAccessToken(): Promise<string | undefined> {
  if (!accessTokenRefresher) {
    return undefined;
  }

  pendingAccessTokenRefresh ??= accessTokenRefresher().finally(() => {
    pendingAccessTokenRefresh = undefined;
  });

  return pendingAccessTokenRefresh;
}

export function persistCsrfToken(token: string, maxAgeSeconds: number): void {
  const secure = globalThis.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${csrfCookieName}=${encodeURIComponent(token)}; Path=/; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearPersistedCsrfToken(): void {
  const secure = globalThis.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${csrfCookieName}=; Path=/; SameSite=Strict; Max-Age=0${secure}`;
}

function csrfToken(): string | undefined {
  return document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${csrfCookieName}=`))
    ?.slice(csrfCookieName.length + 1);
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  accessToken?: string,
  retryAfterRefresh = true,
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('accept', 'application/json');
  if (options.body && !(options.body instanceof FormData)) {
    headers.set('content-type', 'application/json');
  }
  if (accessToken) {
    headers.set('authorization', `Bearer ${accessToken}`);
  }
  if (['POST', 'PATCH', 'DELETE'].includes(options.method ?? 'GET')) {
    const csrf = csrfToken();
    if (csrf) {
      headers.set('x-csrf-token', csrf);
    }
  }
  const response = await fetch(`${readApiBaseUrl()}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });
  if (response.status === 401 && accessToken && retryAfterRefresh) {
    const refreshedAccessToken = await refreshAccessToken();
    if (refreshedAccessToken) {
      return apiRequest<T>(path, options, refreshedAccessToken, false);
    }
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const body = (await response.json()) as
    ApiEnvelope<T> | { error?: { code?: string; message?: string } };
  if (!response.ok) {
    const error = 'error' in body ? body.error : undefined;
    throw new ApiError(
      error?.code ?? 'REQUEST_FAILED',
      error?.message ?? 'Request failed',
      response.status,
    );
  }
  return (body as ApiEnvelope<T>).data;
}
