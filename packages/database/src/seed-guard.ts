export type SeedEnvironment = Readonly<Record<string, string | undefined>>;

const allowedEnvironments = new Set(['development', 'test']);

export interface SeedAuthorization {
  appEnvironment: 'development' | 'test';
  databaseName: string;
  databaseUrl: string;
}

export function authorizeDatabaseSeed(environment: SeedEnvironment): SeedAuthorization {
  const appEnvironment = environment.APP_ENV;
  const databaseUrl = environment.DATABASE_URL;

  if (!appEnvironment || !allowedEnvironments.has(appEnvironment)) {
    throw new Error(
      `Database seed is disabled for APP_ENV=${appEnvironment ?? 'missing'}; use development or test`,
    );
  }

  if (environment.ALLOW_DATABASE_SEED !== 'true') {
    throw new Error('Set ALLOW_DATABASE_SEED=true to opt in to the no-business-data seed');
  }

  if (
    environment.RAILWAY_ENVIRONMENT_ID ||
    environment.RAILWAY_PROJECT_ID ||
    environment.RAILWAY_SERVICE_ID
  ) {
    throw new Error('Database seed is blocked inside Railway environments');
  }

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run the development/test seed');
  }

  const parsed = new URL(databaseUrl);
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use postgres:// or postgresql://');
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, '').split('/')[0] ?? '');
  if (!databaseName || environment.SEED_DATABASE_NAME_CONFIRMATION !== databaseName) {
    throw new Error(
      'SEED_DATABASE_NAME_CONFIRMATION must exactly match the DATABASE_URL database name',
    );
  }

  const localHosts = new Set(['127.0.0.1', '::1', 'localhost']);
  if (!localHosts.has(parsed.hostname) && environment.ALLOW_REMOTE_DATABASE_SEED !== 'true') {
    throw new Error(
      'Remote seed target rejected; set ALLOW_REMOTE_DATABASE_SEED=true only for an isolated dev/test database',
    );
  }

  return {
    appEnvironment: appEnvironment as SeedAuthorization['appEnvironment'],
    databaseName,
    databaseUrl,
  };
}
