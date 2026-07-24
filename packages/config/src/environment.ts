import { z } from 'zod';

const appEnvironmentSchema = z.enum(['development', 'production', 'staging', 'test']);
const nodeEnvironmentSchema = z.enum(['development', 'production', 'test']);

const serviceEnvironmentSchema = z.object({
  APP_ENV: appEnvironmentSchema.default('development'),
  DATABASE_URL: z.string().min(1),
  NODE_ENV: nodeEnvironmentSchema.default('development'),
  REDIS_URL: z.string().url(),
});

const portSchema = z.coerce.number().int().min(1).max(65_535);

export const apiEnvironmentSchema = serviceEnvironmentSchema.extend({
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: portSchema.default(3000),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  PORT: portSchema.optional(),
});

export const workerEnvironmentSchema = serviceEnvironmentSchema.extend({
  PORT: portSchema.optional(),
  WORKER_HOST: z.string().min(1).default('0.0.0.0'),
  WORKER_PORT: portSchema.default(3001),
});

export const webEnvironmentSchema = z.object({
  VITE_API_URL: z.string().url().default('http://localhost:3000'),
});

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;
export type WebEnvironment = z.infer<typeof webEnvironmentSchema>;

export function validateApiEnvironment(input: Record<string, unknown>): ApiEnvironment {
  return apiEnvironmentSchema.parse(input);
}

export function validateWorkerEnvironment(input: Record<string, unknown>): WorkerEnvironment {
  return workerEnvironmentSchema.parse(input);
}

export function validateWebEnvironment(input: Record<string, unknown>): WebEnvironment {
  return webEnvironmentSchema.parse(input);
}

export function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
