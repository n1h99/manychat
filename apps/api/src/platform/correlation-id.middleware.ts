import { Injectable, type NestMiddleware } from '@nestjs/common';
import { createCorrelationId } from '@omnicus/shared';
import type { NextFunction, Request, Response } from 'express';

export interface CorrelatedRequest extends Request {
  correlationId?: string;
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(request: CorrelatedRequest, response: Response, next: NextFunction): void {
    const header = request.header('x-correlation-id');
    const correlationId = createCorrelationId(header);

    request.correlationId = correlationId;
    response.setHeader('x-correlation-id', correlationId);
    next();
  }
}
