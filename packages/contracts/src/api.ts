import { z } from 'zod';

export const apiErrorCodeSchema = z.enum([
  'DEPENDENCY_UNAVAILABLE',
  'INTERNAL_ERROR',
  'NOT_FOUND',
  'VALIDATION_ERROR',
]);

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode | string;
    message: string;
    details: unknown;
    correlationId: string;
  };
}

export interface ApiSuccessBody<TData, TMeta = Record<string, never>> {
  data: TData;
  meta: TMeta;
}

export interface HealthDependency {
  latencyMs: number;
  status: 'down' | 'up';
}

export interface ReadinessData {
  dependencies: {
    database: HealthDependency;
    redis: HealthDependency;
  };
  status: 'ready';
}

export interface LivenessData {
  service: string;
  status: 'live';
  timestamp: string;
}
