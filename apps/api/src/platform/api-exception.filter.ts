import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiErrorBody } from '@omnicus/contracts';
import type { Response } from 'express';

import type { CorrelatedRequest } from './correlation-id.middleware';

interface HttpErrorResponse {
  code?: string;
  details?: unknown;
  message?: string | string[];
}

export const SAFE_API_CODE_MESSAGES: Readonly<Record<string, string>> = {
  AUTOMATION_IDEMPOTENCY_CONFLICT:
    'This automation request reuses an idempotency key with different data',
  AUTOMATION_RESUME_AT_NOT_ALLOWED: 'A resume time is allowed only for paused automation',
  AUTOMATION_RESUME_AT_REQUIRED: 'Choose when the paused automation should resume',
  AUTOMATION_REVISION_CONFLICT: 'Automation state changed. Refresh it before trying again',
  BOT_COMMAND_INVALID: 'One or more bot commands are invalid',
  BOT_COMMAND_SCOPE_INVALID: 'The selected bot command scope is invalid',
  BOT_INTERFACE_REVISION_CONFLICT: 'Bot menu settings changed. Refresh them before saving again',
  BOT_MENU_BUTTON_INVALID: 'One or more bot menu buttons are invalid',
  CHANNEL_IDENTITY_NOT_FOUND: 'The Telegram identity is no longer available for this conversation',
  CONNECTION_NOT_FOUND: 'The Telegram connection was not found',
  CRM_BASE_URL_HTTPS_REQUIRED: 'Enter a public HTTPS CRM address',
  CRM_BASE_URL_INVALID: 'Enter a valid CRM address',
  CRM_CONNECTION_NOT_FOUND: 'The CRM connection was not found',
  CRM_CONNECTION_NOT_PAIRED: 'Pair this CRM project before continuing',
  CRM_CORRELATION_ID_REQUIRED: 'The CRM request is missing its correlation ID',
  CRM_MEDIA_GROUP_NOT_FOUND: 'The requested media group was not found',
  CRM_OPERATION_NOT_FOUND: 'The CRM operation was not found',
  CRM_OPERATION_NOT_TERMINAL: 'Wait until the CRM operation reaches a final state',
  CRM_OPERATION_STATE_CHANGED: 'The CRM operation changed. Refresh it before trying again',
  CRM_PROJECT_ROUTE_NOT_FOUND: 'No active CRM route exists for this project',
  CRM_RECURRENCE_END_INVALID: 'Choose a recurrence end after the first scheduled delivery',
  CRM_RECURRENCE_INVALID: 'The recurring schedule settings are invalid',
  CRM_REPLY_MARKUP_CONFLICT: 'Choose only one reply markup type for this message',
  CRM_RICH_MESSAGE_INVALID: 'The rich Telegram message settings are invalid',
  CRM_RICH_MESSAGE_MEDIA_INVALID: 'The selected rich-message media is invalid',
  CRM_RICH_MESSAGE_MEDIA_REFERENCE_MISSING:
    'The selected rich-message media is no longer available',
  CRM_SCHEDULE_ALREADY_PROCESSING: 'This scheduled message is already being processed',
  CRM_SCHEDULE_IDEMPOTENCY_CONFLICT:
    'This scheduling request reuses an idempotency key with different data',
  CRM_SCHEDULE_NOT_CANCELLABLE: 'This scheduled message can no longer be cancelled',
  CRM_SCHEDULE_NOT_FOUND: 'The scheduled message was not found',
  CRM_SCHEDULE_REVISION_CONFLICT: 'The scheduled message changed. Refresh it before saving again',
  CRM_SCHEDULE_TIME_INVALID: 'Choose a valid future delivery time',
  CRM_SCHEDULE_TIMEZONE_INVALID: 'Choose a valid timezone for the scheduled message',
  CRM_STRUCTURED_MESSAGE_CONFLICT: 'Choose only one structured message type',
  CRM_STRUCTURED_MESSAGE_INVALID: 'The structured Telegram message settings are invalid',
  CRM_UNKNOWN_RETRY_CONFIRMATION_REQUIRED:
    'Confirm the unknown delivery result before retrying this CRM operation',
  DRAFT_CONTENT_CONFLICT: 'Choose only one draft content format',
  GLOBAL_ROLE_NOT_FOUND: 'The selected global role was not found',
  IDEMPOTENCY_CONFLICT: 'This request reuses an idempotency key with different data',
  INVITATION_ACCOUNT_AUTH_FAILED: 'The password for the invited account is incorrect',
  INVITATION_ALREADY_ACTIVE: 'An active invitation already exists for this account and scope',
  INVITATION_INVALID: 'This invitation link is invalid',
  INVITATION_NOT_ACTIVE: 'This invitation was already used, revoked or expired',
  INVITATION_NOT_FOUND: 'The invitation was not found',
  INVITATION_PROFILE_REQUIRED: 'Enter a first and last name for the new account',
  MEDIA_GROUP_ASSET_NOT_FOUND: 'One or more media-group files are no longer available',
  MEDIA_GROUP_ENTITIES_INVALID: 'The media-group caption formatting is invalid',
  MEDIA_GROUP_KIND_COMBINATION_INVALID: 'These media types cannot be combined in one media group',
  MEDIA_GROUP_SPOILER_INVALID: 'Spoiler mode is not supported for one or more selected files',
  MESSAGE_ENTITIES_INVALID: 'The Telegram message formatting is invalid',
  MESSAGE_MUTATION_INVALID: 'The requested message change is invalid',
  MESSAGE_MUTATION_REQUIRED: 'Provide a message change before saving',
  MESSAGE_NOT_EDITABLE: 'This Telegram message can no longer be edited',
  MESSAGE_NOT_FOUND: 'The Telegram message was not found',
  OPERATION_NOT_FAILED: 'Only a failed operation can be retried',
  OPERATION_CHANGED_REFRESH_REQUIRED:
    'The operation changed. Refresh its current status before continuing',
  OPERATION_NOT_FOUND: 'The requested operation was not found',
  OPERATION_NOT_RETRYABLE: 'This operation does not support a safe manual retry',
  OPERATION_PAYLOAD_INVALID: 'The saved operation data is invalid and cannot be retried safely',
  OPERATION_RECONCILIATION_UNAVAILABLE:
    'This provider outcome cannot be reconciled from the generic operations screen',
  PASSWORD_RESET_INVALID: 'This password reset link is invalid, expired or already used',
  PROJECT_MEMBER_EXISTS: 'This user is already a member of the project',
  PROJECT_ROLE_NOT_FOUND: 'The selected project role was not found',
  PROJECT_SLUG_EXISTS: 'Choose a different project slug because this one is already in use',
  RICH_DRAFT_INVALID: 'The rich draft settings are invalid',
  RICH_DRAFT_MEDIA_INVALID: 'The selected rich-draft media is invalid',
  RICH_DRAFT_MEDIA_NOT_REUSABLE: 'The selected media cannot be reused in this rich draft',
  ROLE_IN_USE: 'Remove this role from every assigned user before deleting it',
  ROLE_NAME_EXISTS: 'A role with this name already exists in this scope',
  ROLE_NAME_INVALID: 'Enter a role name that contains letters or numbers',
  ROLE_PERMISSION_NOT_FOUND: 'One or more selected permissions are not available in this scope',
  SYSTEM_ROLE_IMMUTABLE: 'Built-in system roles cannot be edited or deleted',
  UNKNOWN_REQUIRES_RECONCILIATION:
    'Reconcile the unknown delivery result before attempting a retry',
  USER_NOT_FOUND: 'The selected user was not found',
};

function isHttpErrorResponse(value: unknown): value is HttpErrorResponse {
  return typeof value === 'object' && value !== null;
}

function codeForStatus(status: number): string {
  if (status === HttpStatus.BAD_REQUEST) {
    return 'VALIDATION_ERROR';
  }
  if (status === HttpStatus.NOT_FOUND) {
    return 'NOT_FOUND';
  }
  if (status === HttpStatus.SERVICE_UNAVAILABLE) {
    return 'DEPENDENCY_UNAVAILABLE';
  }
  return 'INTERNAL_ERROR';
}

interface LoggedError {
  cause?: LoggedError | { value: string };
  errors?: Array<LoggedError | { value: string }>;
  message: string;
  name: string;
  stack?: string;
}

function errorForServerLog(
  error: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): LoggedError | { value: string } {
  if (!(error instanceof Error)) {
    return { value: String(error) };
  }

  if (depth >= 8 || seen.has(error)) {
    return { value: depth >= 8 ? '[Error cause depth truncated]' : '[Circular error cause]' };
  }
  seen.add(error);

  const logged: LoggedError = {
    message: error.message,
    name: error.name,
    ...(error.stack ? { stack: error.stack } : {}),
  };

  if (error.cause !== undefined) {
    logged.cause = errorForServerLog(error.cause, seen, depth + 1);
  }

  if (error instanceof AggregateError) {
    logged.errors = error.errors
      .slice(0, 10)
      .map((nestedError: unknown) => errorForServerLog(nestedError, seen, depth + 1));
  }

  return logged;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<CorrelatedRequest>();
    const response = context.getResponse<Response>();
    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse = isHttpException ? exception.getResponse() : undefined;
    const structured = isHttpErrorResponse(exceptionResponse) ? exceptionResponse : undefined;
    const correlationId = request.correlationId ?? 'unavailable';
    const serverError = status >= 500;
    const rawMessage = structured?.message;
    const message = serverError
      ? status === HttpStatus.SERVICE_UNAVAILABLE
        ? 'Service temporarily unavailable'
        : 'An internal error occurred'
      : Array.isArray(rawMessage)
        ? 'Request validation failed'
        : (rawMessage ?? SAFE_API_CODE_MESSAGES[structured?.code ?? ''] ?? 'Request failed');
    const details = serverError
      ? null
      : (structured?.details ?? (Array.isArray(rawMessage) ? { violations: rawMessage } : null));

    if (serverError) {
      this.logger.error({
        correlationId,
        exception: errorForServerLog(exception),
        message: 'API request failed',
        status,
      });
    }

    const body: ApiErrorBody = {
      error: {
        code: serverError ? codeForStatus(status) : (structured?.code ?? codeForStatus(status)),
        correlationId,
        details,
        message,
      },
    };

    response.status(status).json(body);
  }
}
