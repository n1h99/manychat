import { readWebEnvironment } from './env';

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

function csrfToken(): string | undefined {
  return document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith('omnicus_csrf='))
    ?.slice('omnicus_csrf='.length);
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  accessToken?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('accept', 'application/json');
  if (options.body) {
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
  const response = await fetch(`${readWebEnvironment().VITE_API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });
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
