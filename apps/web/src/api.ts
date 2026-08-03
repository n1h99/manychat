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
    public readonly correlationId?: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

const statusReasons: Record<number, string> = {
  400: 'Review the entered values and try again.',
  401: 'Your session has expired. Sign in again.',
  403: 'You do not have permission to perform this action.',
  404: 'The requested record is no longer available.',
  409: 'The data changed in another session. Refresh and try again.',
  413: 'The selected file is too large.',
  429: 'Too many requests. Wait a moment and try again.',
  500: 'The server could not complete the action.',
  502: 'A required service is temporarily unavailable.',
  503: 'A required service is temporarily unavailable.',
};

const codeReasons: Record<string, string> = {
  AUTOMATION_SECRET_IN_USE: 'This secret is still used by a published scenario.',
  BROADCAST_CANNOT_CANCEL: 'This broadcast can no longer be cancelled.',
  BROADCAST_CANNOT_LAUNCH: 'This broadcast is not ready to launch.',
  BROADCAST_CANNOT_PAUSE: 'Only a running broadcast can be paused.',
  BROADCAST_CANNOT_RESUME: 'Only a paused broadcast can be resumed.',
  BROADCAST_NAME_EXISTS: 'A broadcast with this name already exists.',
  BROADCAST_SCHEDULE_MUST_BE_FUTURE: 'Choose a future delivery time.',
  CHANNEL_NOT_ACTIVE: 'Activate the Telegram channel before continuing.',
  CRM_CONNECTION_NOT_PAIRED: 'Pair this CRM project before continuing.',
  CUSTOM_FIELD_KEY_EXISTS: 'A custom field with this key already exists.',
  GLOBAL_ROLE_NOT_FOUND: 'The selected global role is no longer available.',
  MEDIA_USED_BY_PUBLISHED_TEMPLATE: 'This file is used by a published template.',
  MESSAGE_TEMPLATE_NAME_EXISTS: 'A template with this name already exists.',
  OPERATION_NOT_FAILED: 'Only a failed operation can be retried.',
  OPERATION_CHANGED_REFRESH_REQUIRED: 'The operation changed. Refresh it before continuing.',
  OPERATION_NOT_RETRYABLE: 'This operation does not support a safe manual retry.',
  OPERATION_RECONCILIATION_UNAVAILABLE:
    'This provider outcome cannot be reconciled from the generic operations screen.',
  INVITATION_ACCOUNT_AUTH_FAILED: 'The password for the invited account is incorrect.',
  INVITATION_ALREADY_ACTIVE: 'An active invitation already exists for this account.',
  INVITATION_INVALID: 'This invitation link is invalid.',
  INVITATION_NOT_ACTIVE: 'This invitation was already used, revoked or expired.',
  INVITATION_PROFILE_REQUIRED: 'Enter a first and last name for the new account.',
  PASSWORD_RESET_INVALID: 'This reset link is invalid, expired or already used.',
  PROJECT_MEMBER_EXISTS: 'This user is already a member of the project.',
  PROJECT_ROLE_NOT_FOUND: 'The selected project role is no longer available.',
  PROJECT_SLUG_EXISTS: 'This slug is already used by another active or archived project.',
  SCENARIO_DRAFT_CONFLICT: 'This draft changed in another session. Reload it before saving.',
  SEGMENT_NAME_EXISTS: 'A segment with this name already exists.',
  TAG_NAME_EXISTS: 'A tag with this name already exists.',
  ROLE_IN_USE: 'Remove this role from assigned users before deleting it.',
  ROLE_NAME_EXISTS: 'A role with this name already exists.',
  ROLE_NAME_INVALID: 'Enter a role name containing letters or numbers.',
  ROLE_PERMISSION_NOT_FOUND: 'One or more selected permissions are unavailable.',
  SYSTEM_ROLE_IMMUTABLE: 'Built-in system roles cannot be changed.',
  TELEGRAM_CONNECTION_TEST_FAILED: 'Telegram did not confirm this connection.',
  TELEGRAM_TOKEN_INVALID: 'Telegram rejected this bot token.',
  TELEGRAM_WEBHOOK_CONNECT_FAILED: 'Telegram could not connect the webhook.',
  USER_EMAIL_EXISTS: 'A user with this email already exists.',
  USER_NOT_FOUND: 'The selected user is no longer available.',
};

function validationReason(details: unknown): string | undefined {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
  const violations = (details as { violations?: unknown }).violations;
  if (!Array.isArray(violations)) return undefined;
  const fields = violations
    .filter((violation): violation is string => typeof violation === 'string')
    .map((violation) => violation.match(/^([A-Za-z][A-Za-z0-9_.]*)\s/)?.[1])
    .filter((field): field is string => Boolean(field))
    .map((field) => field.split('.').at(-1)!)
    .map((field) => field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase());
  const unique = [...new Set(fields)];
  if (!unique.length) return undefined;
  return `Review ${unique.slice(0, 3).join(', ')}${unique.length > 3 ? ' and the other fields' : ''}.`;
}

function safeApiReason(message: string): string | undefined {
  const normalized = message.trim();
  if (!normalized || ['Request failed', 'Request validation failed'].includes(normalized))
    return undefined;
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

export function getUserErrorMessage(
  error: unknown,
  fallback = 'The action could not be completed.',
): string {
  if (!(error instanceof ApiError)) {
    if (error instanceof TypeError && /fetch|network|load/i.test(error.message))
      return `${fallback} The server is not reachable right now.`;
    return fallback;
  }
  const reason =
    codeReasons[error.code] ??
    (error.code === 'VALIDATION_ERROR' ? validationReason(error.details) : undefined) ??
    (error.status < 500 ? safeApiReason(error.message) : undefined) ??
    statusReasons[error.status];
  const reference =
    error.status >= 500 && error.correlationId && error.correlationId !== 'unavailable'
      ? ` Reference: ${error.correlationId}.`
      : '';
  return `${fallback}${reason ? ` ${reason}` : ''}${reference}`;
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | undefined;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | undefined): void {
  unauthorizedHandler = handler;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  accessToken?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('accept', 'application/json');
  if (options.body && !(options.body instanceof FormData)) {
    headers.set('content-type', 'application/json');
  }
  if (accessToken) {
    headers.set('authorization', `Bearer ${accessToken}`);
  }
  const response = await fetch(`${readApiBaseUrl()}${path}`, {
    ...options,
    credentials: 'omit',
    headers,
  });
  if (response.status === 401 && accessToken) {
    unauthorizedHandler?.();
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const body = (await response.json()) as
    | ApiEnvelope<T>
    | {
        error?: {
          code?: string;
          correlationId?: string;
          details?: unknown;
          message?: string;
        };
      };
  if (!response.ok) {
    const error = 'error' in body ? body.error : undefined;
    throw new ApiError(
      error?.code ?? 'REQUEST_FAILED',
      error?.message ?? 'Request failed',
      response.status,
      error?.correlationId,
      error?.details,
    );
  }
  return (body as ApiEnvelope<T>).data;
}
