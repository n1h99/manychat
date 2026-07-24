import { resolve } from 'node:path';

import { config as loadEnvironment } from 'dotenv';

import { createDatabaseHandle } from './client';
import { authorizeDatabaseSeed } from './seed-guard';

loadEnvironment({ path: resolve(__dirname, '../../../.env'), quiet: true });

async function seed(): Promise<void> {
  const authorization = authorizeDatabaseSeed(process.env);
  const database = createDatabaseHandle(authorization.databaseUrl);

  try {
    await database.client.$queryRaw`SELECT 1`;
    process.stdout.write(
      `${JSON.stringify({
        databaseName: authorization.databaseName,
        environment: authorization.appEnvironment,
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
