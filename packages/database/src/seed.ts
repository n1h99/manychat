import { config as loadEnvironment } from 'dotenv';

import { createDatabaseHandle } from './client';

loadEnvironment({ path: '../../.env', quiet: true });

const allowedEnvironments = new Set(['development', 'test']);
const appEnvironment = process.env.APP_ENV ?? 'development';
const databaseUrl = process.env.DATABASE_URL;

async function seed(): Promise<void> {
  if (!allowedEnvironments.has(appEnvironment)) {
    throw new Error(`Database seed is disabled for APP_ENV=${appEnvironment}`);
  }

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run the development/test seed');
  }

  const database = createDatabaseHandle(databaseUrl);
  try {
    await database.client.$queryRaw`SELECT 1`;
    process.stdout.write(
      `${JSON.stringify({
        environment: appEnvironment,
        level: 'log',
        message: 'Development/test seed completed; no business records were created',
        service: 'database-seed',
      })}\n`,
    );
  } finally {
    await database.close();
  }
}

void seed().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown seed error';
  process.stderr.write(
    `${JSON.stringify({ level: 'error', message, service: 'database-seed' })}\n`,
  );
  process.exitCode = 1;
});
