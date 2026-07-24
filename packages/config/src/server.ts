import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, join, parse, resolve } from 'node:path';

import { z } from 'zod';

const appEnvironmentSchema = z.enum(['development', 'production', 'staging', 'test']);
const nodeEnvironmentSchema = z.enum(['development', 'production', 'test']);
const portSchema = z.coerce.number().int().min(1).max(65_535);
const durationSchema = z.coerce.number().int().min(250).max(60_000);

const booleanEnvironmentSchema = z.enum(['true', 'false']).transform((value) => value === 'true');

function urlWithProtocol(protocols: readonly string[], name: string) {
  return z
    .string()
    .url()
    .refine((value) => protocols.includes(new URL(value).protocol), {
      message: `${name} must use ${protocols.join(' or ')}`,
    });
}

const exactHttpOriginSchema = z.string().superRefine((value, context) => {
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.origin !== value ||
      parsed.username.length > 0 ||
      parsed.password.length > 0
    ) {
      context.addIssue({
        code: 'custom',
        message: 'CORS origin must be an exact HTTP(S) origin without credentials or path',
      });
    }
  } catch {
    context.addIssue({
      code: 'custom',
      message: 'CORS origin must be a valid HTTP(S) origin',
    });
  }
});

const corsOriginsSchema = z.string().superRefine((value, context) => {
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    context.addIssue({ code: 'custom', message: 'At least one CORS origin is required' });
    return;
  }

  for (const origin of origins) {
    const result = exactHttpOriginSchema.safeParse(origin);
    if (!result.success) {
      context.addIssue({
        code: 'custom',
        message: `Invalid CORS origin: ${origin}`,
      });
    }
  }
});

const trustProxySchema = z
  .string()
  .default('loopback,linklocal,uniquelocal')
  .superRefine((value, context) => {
    const allowedNamedRanges = new Set(['linklocal', 'loopback', 'uniquelocal']);
    const entries = value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    const isValidAddressOrCidr = (entry: string): boolean => {
      const separatorIndex = entry.lastIndexOf('/');
      const address = separatorIndex === -1 ? entry : entry.slice(0, separatorIndex);
      const addressFamily = isIP(address);

      if (addressFamily === 0) {
        return false;
      }

      if (separatorIndex === -1) {
        return true;
      }

      const prefix = entry.slice(separatorIndex + 1);
      const maximumPrefix = addressFamily === 4 ? 32 : 128;
      return /^\d{1,3}$/.test(prefix) && Number(prefix) > 0 && Number(prefix) <= maximumPrefix;
    };

    if (
      entries.length === 0 ||
      entries.some((entry) => !allowedNamedRanges.has(entry) && !isValidAddressOrCidr(entry))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'TRUST_PROXY must contain only explicit IP/CIDR or named private ranges',
      });
    }
  });

const serviceEnvironmentSchema = z.object({
  APP_ENV: appEnvironmentSchema,
  DATABASE_URL: urlWithProtocol(['postgres:', 'postgresql:'], 'DATABASE_URL'),
  NODE_ENV: nodeEnvironmentSchema,
  PORT: portSchema.optional(),
  REDIS_URL: urlWithProtocol(['redis:', 'rediss:'], 'REDIS_URL'),
});

export const apiEnvironmentSchema = serviceEnvironmentSchema
  .extend({
    API_HOST: z.string().min(1).default('0.0.0.0'),
    API_PORT: portSchema.default(3000),
    CORS_ALLOWED_ORIGINS: corsOriginsSchema,
    SWAGGER_ENABLED: booleanEnvironmentSchema.default(false),
    TRUST_PROXY: trustProxySchema,
  })
  .superRefine((environment, context) => {
    if (
      (environment.APP_ENV === 'production' || environment.APP_ENV === 'staging') &&
      environment.NODE_ENV !== 'production'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'NODE_ENV must be production for staging and production',
        path: ['NODE_ENV'],
      });
    }

    if (environment.APP_ENV === 'production' && environment.SWAGGER_ENABLED) {
      context.addIssue({
        code: 'custom',
        message: 'Swagger cannot be enabled in production',
        path: ['SWAGGER_ENABLED'],
      });
    }

    if (
      environment.APP_ENV === 'production' &&
      parseCorsOrigins(environment.CORS_ALLOWED_ORIGINS).includes('*')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Wildcard CORS is forbidden in production',
        path: ['CORS_ALLOWED_ORIGINS'],
      });
    }
  });

export const workerEnvironmentSchema = serviceEnvironmentSchema
  .extend({
    BULLMQ_READY_TIMEOUT_MS: durationSchema.default(5_000),
    DEMO_JOB_ENABLED: booleanEnvironmentSchema.default(false),
    WORKER_HOST: z.string().min(1).default('0.0.0.0'),
    WORKER_PORT: portSchema.default(3001),
    WORKER_SHUTDOWN_TIMEOUT_MS: durationSchema.default(10_000),
  })
  .superRefine((environment, context) => {
    if (
      (environment.APP_ENV === 'production' || environment.APP_ENV === 'staging') &&
      environment.NODE_ENV !== 'production'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'NODE_ENV must be production for staging and production',
        path: ['NODE_ENV'],
      });
    }

    if (
      environment.DEMO_JOB_ENABLED &&
      environment.APP_ENV !== 'development' &&
      environment.APP_ENV !== 'test'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Demo jobs are allowed only in development or test',
        path: ['DEMO_JOB_ENABLED'],
      });
    }
  });

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;

export function validateApiEnvironment(input: Record<string, unknown>): ApiEnvironment {
  return apiEnvironmentSchema.parse(input);
}

export function validateWorkerEnvironment(input: Record<string, unknown>): WorkerEnvironment {
  return workerEnvironmentSchema.parse(input);
}

export function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function parseTrustProxy(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function findRepositoryRoot(startDirectory = __dirname): string {
  let candidate = resolve(startDirectory);
  const filesystemRoot = parse(candidate).root;

  while (true) {
    if (
      existsSync(join(candidate, 'package.json')) &&
      existsSync(join(candidate, 'pnpm-workspace.yaml'))
    ) {
      return candidate;
    }

    if (candidate === filesystemRoot) {
      throw new Error('Unable to locate the Omnicus repository root');
    }

    candidate = dirname(candidate);
  }
}

export function rootEnvironmentFilePath(startDirectory = __dirname): string | undefined {
  try {
    return join(findRepositoryRoot(startDirectory), '.env');
  } catch {
    // A pruned production artifact may not include workspace marker files.
    // In that case ConfigModule must validate process.env without a CWD fallback.
    return undefined;
  }
}
