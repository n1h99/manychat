import { describe, expect, it } from 'vitest';

import { parseCorsOrigins, validateApiEnvironment } from './environment';

const databaseUrl = 'postgresql://omnicus:omnicus@localhost:5432/omnicus';
const redisUrl = 'redis://localhost:6379';

describe('environment validation', () => {
  it('applies safe local defaults', () => {
    const config = validateApiEnvironment({
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
    });

    expect(config.API_PORT).toBe(3000);
    expect(config.APP_ENV).toBe('development');
  });

  it('rejects an invalid Redis URL', () => {
    expect(() =>
      validateApiEnvironment({
        DATABASE_URL: databaseUrl,
        REDIS_URL: 'not-a-url',
      }),
    ).toThrow();
  });

  it('normalizes the CORS allowlist', () => {
    expect(parseCorsOrigins('http://localhost:5173, https://example.test ')).toEqual([
      'http://localhost:5173',
      'https://example.test',
    ]);
  });
});
