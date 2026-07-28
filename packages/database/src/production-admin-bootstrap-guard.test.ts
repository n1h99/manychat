import { describe, expect, it } from 'vitest';

import {
  authorizeProductionAdminBootstrap,
  type ProductionBootstrapEnvironment,
} from './production-admin-bootstrap-guard';

const authorizedEnvironment: ProductionBootstrapEnvironment = {
  ALLOW_PRODUCTION_ADMIN_BOOTSTRAP: 'true',
  APP_ENV: 'production',
  BOOTSTRAP_ADMIN_EMAIL: 'admin@example.test',
  BOOTSTRAP_ADMIN_FIRST_NAME: 'Admin',
  BOOTSTRAP_ADMIN_LAST_NAME: 'User',
  BOOTSTRAP_ADMIN_PASSWORD: 'test-only-password-with-16-characters',
  BOOTSTRAP_DATABASE_NAME_CONFIRMATION: 'railway',
  BOOTSTRAP_RAILWAY_PROJECT_NAME_CONFIRMATION: 'omnicus-production',
  DATABASE_URL: 'postgresql://omnicus:secret@postgres.railway.internal:5432/railway',
  RAILWAY_ENVIRONMENT_ID: 'environment-id',
  RAILWAY_PROJECT_ID: 'project-id',
  RAILWAY_PROJECT_NAME: 'omnicus-production',
  RAILWAY_SERVICE_ID: 'service-id',
};

describe('production admin bootstrap guard', () => {
  it('authorizes an explicitly confirmed Railway production target', () => {
    expect(authorizeProductionAdminBootstrap(authorizedEnvironment)).toMatchObject({
      adminEmail: 'admin@example.test',
      databaseName: 'railway',
      railwayProjectName: 'omnicus-production',
    });
  });

  it.each(['development', 'test', undefined])('rejects APP_ENV=%s', (appEnvironment) => {
    expect(() =>
      authorizeProductionAdminBootstrap({
        ...authorizedEnvironment,
        APP_ENV: appEnvironment,
      }),
    ).toThrow(/APP_ENV/);
  });

  it('requires the explicit one-time opt-in', () => {
    expect(() =>
      authorizeProductionAdminBootstrap({
        ...authorizedEnvironment,
        ALLOW_PRODUCTION_ADMIN_BOOTSTRAP: 'false',
      }),
    ).toThrow(/one-time bootstrap/);
  });

  it('rejects execution outside Railway', () => {
    expect(() =>
      authorizeProductionAdminBootstrap({
        ...authorizedEnvironment,
        RAILWAY_PROJECT_ID: undefined,
      }),
    ).toThrow(/Railway/);
  });

  it('requires exact project confirmation', () => {
    expect(() =>
      authorizeProductionAdminBootstrap({
        ...authorizedEnvironment,
        BOOTSTRAP_RAILWAY_PROJECT_NAME_CONFIRMATION: 'another-project',
      }),
    ).toThrow(/exactly match RAILWAY_PROJECT_NAME/);
  });

  it('requires exact database confirmation', () => {
    expect(() =>
      authorizeProductionAdminBootstrap({
        ...authorizedEnvironment,
        BOOTSTRAP_DATABASE_NAME_CONFIRMATION: 'another-database',
      }),
    ).toThrow(/exactly match the DATABASE_URL database name/);
  });

  it('does not accept a short administrator password', () => {
    expect(() =>
      authorizeProductionAdminBootstrap({
        ...authorizedEnvironment,
        BOOTSTRAP_ADMIN_PASSWORD: 'too-short',
      }),
    ).toThrow(/16 characters/);
  });
});
