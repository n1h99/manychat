export type SeedEnvironment = Readonly<Record<string, string | undefined>>;

const allowedEnvironments = new Set(['development', 'test']);

export interface SeedAuthorization {
  adminEmail: string;
  adminFirstName: string;
  adminLastName: string;
  adminPassword: string;
  appEnvironment: 'development' | 'test';
  databaseName: string;
  databaseUrl: string;
}

export function authorizeDatabaseSeed(environment: SeedEnvironment): SeedAuthorization {
  const appEnvironment = environment.APP_ENV;
  const databaseUrl = environment.DATABASE_URL;
  const adminEmail = environment.SEED_ADMIN_EMAIL;
  const adminPassword = environment.SEED_ADMIN_PASSWORD;
  const adminFirstName = environment.SEED_ADMIN_FIRST_NAME;
  const adminLastName = environment.SEED_ADMIN_LAST_NAME;

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

  if (!adminEmail || !adminPassword || !adminFirstName || !adminLastName) {
    throw new Error(
      'SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_FIRST_NAME and SEED_ADMIN_LAST_NAME are required',
    );
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
    adminEmail,
    adminFirstName,
    adminLastName,
    adminPassword,
    appEnvironment: appEnvironment as SeedAuthorization['appEnvironment'],
    databaseName,
    databaseUrl,
  };
}
