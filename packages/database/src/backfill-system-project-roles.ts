import { resolve } from 'node:path';

import { config as loadEnvironment } from 'dotenv';

import { createDatabaseHandle } from './client';
import { seedProjectPermissions } from './seed-permissions';
import { backfillSystemProjectRoles } from './seed-project-roles';
import { authorizeSystemRoleBackfill } from './system-role-backfill-guard';

loadEnvironment({ path: resolve(__dirname, '../../../.env'), quiet: true });

async function backfill(): Promise<void> {
  const authorization = authorizeSystemRoleBackfill(process.env);
  const database = createDatabaseHandle(authorization.databaseUrl);
  try {
    for (const code of seedProjectPermissions) {
      await database.client.permission.upsert({
        create: { code, description: code },
        update: { description: code },
        where: { code },
      });
    }
    const permissions = await database.client.permission.findMany({
      where: { code: { in: [...seedProjectPermissions] } },
    });
    const permissionIdsByCode = new Map(
      permissions.map((permission) => [permission.code, permission.id]),
    );
    const projects = await database.client.project.findMany({ select: { id: true } });
    for (const project of projects) {
      await backfillSystemProjectRoles(database.client, project.id, permissionIdsByCode);
    }
    process.stdout.write(
      `${JSON.stringify({
        databaseName: authorization.databaseName,
        environment: authorization.appEnvironment,
        level: 'log',
        message: 'System project roles synchronized',
        service: 'database-role-backfill',
      })}\n`,
    );
  } finally {
    await database.close();
  }
}

void backfill().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown system role backfill error';
  process.stderr.write(
    `${JSON.stringify({ level: 'error', message, service: 'database-role-backfill' })}\n`,
  );
  process.exitCode = 1;
});
