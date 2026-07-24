import {
  Catch,
  HttpException,
  HttpStatus,
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

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<CorrelatedRequest>();
    const response = context.getResponse<Response>();
    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse = isHttpException ? exception.getResponse() : undefined;
    const structured = isHttpErrorResponse(exceptionResponse) ? exceptionResponse : undefined;
    const rawMessage = structured?.message;
    const message = Array.isArray(rawMessage)
      ? 'Request validation failed'
      : (rawMessage ?? (status >= 500 ? 'An internal error occurred' : 'Request failed'));
    const details =
      structured?.details ?? (Array.isArray(rawMessage) ? { violations: rawMessage } : null);
    const body: ApiErrorBody = {
      error: {
        code: structured?.code ?? codeForStatus(status),
        correlationId: request.correlationId ?? 'unavailable',
        details,
        message,
      },
    };

    response.status(status).json(body);
  }
}
