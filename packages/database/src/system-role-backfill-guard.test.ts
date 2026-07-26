import { describe, expect, it } from 'vitest';

import { authorizeSystemRoleBackfill } from './system-role-backfill-guard';

const environment = {
  ALLOW_SYSTEM_ROLE_BACKFILL: 'true',
  APP_ENV: 'test',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/omnicus_test',
  SEED_DATABASE_NAME_CONFIRMATION: 'omnicus_test',
};

describe('system role backfill guard', () => {
  it('allows an explicitly confirmed local test database', () => {
    expect(authorizeSystemRoleBackfill(environment)).toEqual({
      appEnvironment: 'test',
      databaseName: 'omnicus_test',
      databaseUrl: environment.DATABASE_URL,
    });
  });

  it('rejects staging and missing explicit opt-in', () => {
    expect(() => authorizeSystemRoleBackfill({ ...environment, APP_ENV: 'staging' })).toThrow(
      /disabled/,
    );
    expect(() =>
      authorizeSystemRoleBackfill({ ...environment, ALLOW_SYSTEM_ROLE_BACKFILL: undefined }),
    ).toThrow(/ALLOW_SYSTEM_ROLE_BACKFILL/);
  });
});
