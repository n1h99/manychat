export type ProductionBootstrapEnvironment = Readonly<Record<string, string | undefined>>;

export interface ProductionAdminBootstrapAuthorization {
  adminEmail: string;
  adminFirstName: string;
  adminLastName: string;
  adminPassword: string;
  databaseName: string;
  databaseUrl: string;
  railwayProjectName: string;
}

export function authorizeProductionAdminBootstrap(
  environment: ProductionBootstrapEnvironment,
): ProductionAdminBootstrapAuthorization {
  if (environment.APP_ENV !== 'production' && environment.APP_ENV !== 'staging') {
    throw new Error('Production admin bootstrap requires APP_ENV=production or staging');
  }

  if (environment.ALLOW_PRODUCTION_ADMIN_BOOTSTRAP !== 'true') {
    throw new Error('Set ALLOW_PRODUCTION_ADMIN_BOOTSTRAP=true for the one-time bootstrap');
  }

  const railwayProjectName = environment.RAILWAY_PROJECT_NAME;
  if (
    !environment.RAILWAY_PROJECT_ID ||
    !environment.RAILWAY_ENVIRONMENT_ID ||
    !environment.RAILWAY_SERVICE_ID ||
    !railwayProjectName
  ) {
    throw new Error('Production admin bootstrap is restricted to a Railway service');
  }

  if (environment.BOOTSTRAP_RAILWAY_PROJECT_NAME_CONFIRMATION !== railwayProjectName) {
    throw new Error(
      'BOOTSTRAP_RAILWAY_PROJECT_NAME_CONFIRMATION must exactly match RAILWAY_PROJECT_NAME',
    );
  }

  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for production admin bootstrap');
  }

  const parsed = new URL(databaseUrl);
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use postgres:// or postgresql://');
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, '').split('/')[0] ?? '');
  if (!databaseName || environment.BOOTSTRAP_DATABASE_NAME_CONFIRMATION !== databaseName) {
    throw new Error(
      'BOOTSTRAP_DATABASE_NAME_CONFIRMATION must exactly match the DATABASE_URL database name',
    );
  }

  const adminEmail = environment.BOOTSTRAP_ADMIN_EMAIL;
  const adminPassword = environment.BOOTSTRAP_ADMIN_PASSWORD;
  const adminFirstName = environment.BOOTSTRAP_ADMIN_FIRST_NAME;
  const adminLastName = environment.BOOTSTRAP_ADMIN_LAST_NAME;
  if (!adminEmail || !adminPassword || !adminFirstName || !adminLastName) {
    throw new Error(
      'BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD, BOOTSTRAP_ADMIN_FIRST_NAME and BOOTSTRAP_ADMIN_LAST_NAME are required',
    );
  }

  if (adminPassword.length < 16) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must contain at least 16 characters');
  }

  return {
    adminEmail: adminEmail.trim(),
    adminFirstName: adminFirstName.trim(),
    adminLastName: adminLastName.trim(),
    adminPassword,
    databaseName,
    databaseUrl,
    railwayProjectName,
  };
}
