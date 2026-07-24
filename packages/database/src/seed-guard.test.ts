import { describe, expect, it } from 'vitest';

import { authorizeDatabaseSeed, type SeedEnvironment } from './seed-guard';

const authorizedLocalEnvironment: SeedEnvironment = {
  ALLOW_DATABASE_SEED: 'true',
  APP_ENV: 'development',
  DATABASE_URL: 'postgresql://omnicus:omnicus@localhost:5432/omnicus',
  SEED_DATABASE_NAME_CONFIRMATION: 'omnicus',
};

describe('database seed guard', () => {
  it.each(['production', 'staging'])('rejects APP_ENV=%s', (appEnvironment) => {
    expect(() =>
      authorizeDatabaseSeed({
        ...authorizedLocalEnvironment,
        APP_ENV: appEnvironment,
      }),
    ).toThrow(/disabled/);
  });

  it('requires an explicit opt-in', () => {
    expect(() =>
      authorizeDatabaseSeed({
        ...authorizedLocalEnvironment,
        ALLOW_DATABASE_SEED: 'false',
      }),
    ).toThrow(/opt in/);
  });

  it('rejects every Railway environment', () => {
    expect(() =>
      authorizeDatabaseSeed({
        ...authorizedLocalEnvironment,
        RAILWAY_ENVIRONMENT_ID: 'railway-environment',
      }),
    ).toThrow(/Railway/);
  });

  it('requires confirmation of the exact database name', () => {
    expect(() =>
      authorizeDatabaseSeed({
        ...authorizedLocalEnvironment,
        SEED_DATABASE_NAME_CONFIRMATION: 'different_database',
      }),
    ).toThrow(/exactly match/);
  });

  it('rejects a remote host without a second opt-in', () => {
    expect(() =>
      authorizeDatabaseSeed({
        ...authorizedLocalEnvironment,
        DATABASE_URL: 'postgresql://omnicus:omnicus@db.example.test:5432/omnicus',
      }),
    ).toThrow(/Remote seed target rejected/);
  });

  it('authorizes an explicitly confirmed local development database', () => {
    expect(authorizeDatabaseSeed(authorizedLocalEnvironment)).toEqual({
      appEnvironment: 'development',
      databaseName: 'omnicus',
      databaseUrl: authorizedLocalEnvironment.DATABASE_URL,
    });
  });
});
