import { tmpdir } from 'node:os';
import { parse, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseCorsOrigins,
  parseTrustProxy,
  rootEnvironmentFilePath,
  validateApiEnvironment,
  validateWorkerEnvironment,
} from './server';

const baseEnvironment = {
  APP_ENV: 'test',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://omnicus:omnicus@localhost:5432/omnicus',
  NODE_ENV: 'test',
  REDIS_URL: 'redis://localhost:6379',
};

describe('server environment validation', () => {
  it('does not fall back to a CWD-relative env file outside a workspace', () => {
    const nonWorkspacePath = resolve(parse(tmpdir()).root, '__omnicus_nonworkspace__');
    expect(rootEnvironmentFilePath(nonWorkspacePath)).toBeUndefined();
  });

  it('requires an explicit application environment', () => {
    expect(() =>
      validateApiEnvironment({
        ...baseEnvironment,
        APP_ENV: undefined,
      }),
    ).toThrow();
  });

  it.each(['mysql://localhost/database', 'https://example.test/database'])(
    'rejects non-PostgreSQL DATABASE_URL %s',
    (databaseUrl) => {
      expect(() =>
        validateApiEnvironment({ ...baseEnvironment, DATABASE_URL: databaseUrl }),
      ).toThrow();
    },
  );

  it.each(['http://localhost:6379', 'amqp://localhost'])(
    'rejects non-Redis REDIS_URL %s',
    (redisUrl) => {
      expect(() => validateApiEnvironment({ ...baseEnvironment, REDIS_URL: redisUrl })).toThrow();
    },
  );

  it.each([
    '*',
    'https://example.test/path',
    'https://example.test?query=1',
    'https://user@example.test',
  ])('rejects an inexact CORS origin %s', (origin) => {
    expect(() =>
      validateApiEnvironment({ ...baseEnvironment, CORS_ALLOWED_ORIGINS: origin }),
    ).toThrow();
  });

  it('normalizes a validated CORS allowlist', () => {
    const environment = validateApiEnvironment({
      ...baseEnvironment,
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173,https://example.test',
    });

    expect(parseCorsOrigins(environment.CORS_ALLOWED_ORIGINS)).toEqual([
      'http://localhost:5173',
      'https://example.test',
    ]);
  });

  it('forbids Swagger in production', () => {
    expect(() =>
      validateApiEnvironment({
        ...baseEnvironment,
        APP_ENV: 'production',
        NODE_ENV: 'production',
        SWAGGER_ENABLED: 'true',
      }),
    ).toThrow();
  });

  it('requires an explicit CORS allowlist', () => {
    expect(() =>
      validateApiEnvironment({
        ...baseEnvironment,
        APP_ENV: 'production',
        CORS_ALLOWED_ORIGINS: undefined,
        NODE_ENV: 'production',
      }),
    ).toThrow();
  });

  it.each(['999.1.1.1', '127.0.0.1/99', '0.0.0.0/0', '::/0', 'not-a-network'])(
    'rejects an invalid trust proxy entry %s',
    (entry) => {
      expect(() => validateApiEnvironment({ ...baseEnvironment, TRUST_PROXY: entry })).toThrow();
    },
  );

  it.each(['production', 'staging'] as const)(
    'requires an explicit trust proxy topology for %s',
    (appEnvironment) => {
      expect(() =>
        validateApiEnvironment({
          ...baseEnvironment,
          APP_ENV: appEnvironment,
          NODE_ENV: 'production',
          TRUST_PROXY: undefined,
        }),
      ).toThrow();
    },
  );

  it('uses loopback only as the local development default', () => {
    expect(parseTrustProxy(undefined)).toEqual(['loopback']);
  });

  it('parses worker feature flags without treating false as true', () => {
    const environment = validateWorkerEnvironment({
      ...baseEnvironment,
      DEMO_JOB_ENABLED: 'false',
    });

    expect(environment.DEMO_JOB_ENABLED).toBe(false);
  });

  it.each(['production', 'staging'] as const)('rejects demo jobs in %s', (appEnvironment) => {
    expect(() =>
      validateWorkerEnvironment({
        ...baseEnvironment,
        APP_ENV: appEnvironment,
        DEMO_JOB_ENABLED: 'true',
        NODE_ENV: 'production',
      }),
    ).toThrow();
  });

  it.each(['production', 'staging'] as const)(
    'requires NODE_ENV=production for APP_ENV=%s',
    (appEnvironment) => {
      expect(() =>
        validateWorkerEnvironment({
          ...baseEnvironment,
          APP_ENV: appEnvironment,
          NODE_ENV: 'test',
        }),
      ).toThrow();
    },
  );
});
