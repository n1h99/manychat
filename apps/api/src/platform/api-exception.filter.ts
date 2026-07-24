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
        : (rawMessage ?? 'Request failed');
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
