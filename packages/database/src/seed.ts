import { resolve } from 'node:path';

import { config as loadEnvironment } from 'dotenv';

import { createDatabaseHandle } from './client';
import { authorizeDatabaseSeed } from './seed-guard';
import { seedGlobalPermissions, seedProjectPermissions } from './seed-permissions';
import { backfillSystemProjectRoles } from './seed-project-roles';
import * as argon2 from 'argon2';

loadEnvironment({ path: resolve(__dirname, '../../../.env'), quiet: true });

async function seed(): Promise<void> {
  const authorization = authorizeDatabaseSeed(process.env);
  const database = createDatabaseHandle(authorization.databaseUrl);

  try {
    await database.client.$queryRaw`SELECT 1`;
    const permissionCodes = [...seedGlobalPermissions, ...seedProjectPermissions];
    for (const code of permissionCodes) {
      await database.client.permission.upsert({
        create: { code, description: code },
        update: { description: code },
        where: { code },
      });
    }
    const permissions = await database.client.permission.findMany({
      where: { code: { in: permissionCodes } },
    });
    const permissionsByCode = new Map(
      permissions.map((permission) => [permission.code, permission.id]),
    );
    const superAdmin = await database.client.globalRole.upsert({
      create: { name: 'Super Admin', normalizedName: 'super-admin', system: true },
      update: { name: 'Super Admin', system: true },
      where: { normalizedName: 'super-admin' },
    });
    for (const code of seedGlobalPermissions) {
      const permissionId = permissionsByCode.get(code);
      if (!permissionId) {
        throw new Error(`Missing seed permission: ${code}`);
      }
      await database.client.globalRolePermission.upsert({
        create: { globalRoleId: superAdmin.id, permissionId },
        update: {},
        where: { globalRoleId_permissionId: { globalRoleId: superAdmin.id, permissionId } },
      });
    }
    const normalizedEmail = authorization.adminEmail.trim().toLocaleLowerCase('en-US');
    const passwordHash = await argon2.hash(authorization.adminPassword, { type: argon2.argon2id });
    const admin = await database.client.user.upsert({
      create: {
        email: authorization.adminEmail.trim(),
        firstName: authorization.adminFirstName.trim(),
        lastName: authorization.adminLastName.trim(),
        normalizedEmail,
        passwordHash,
      },
      update: {
        firstName: authorization.adminFirstName.trim(),
        lastName: authorization.adminLastName.trim(),
        passwordHash,
        status: 'ACTIVE',
      },
      where: { normalizedEmail },
    });
    await database.client.globalUserRole.upsert({
      create: { globalRoleId: superAdmin.id, userId: admin.id },
      update: {},
      where: { userId_globalRoleId: { globalRoleId: superAdmin.id, userId: admin.id } },
    });
    const projects = await database.client.project.findMany({ select: { id: true } });
    for (const project of projects) {
      await backfillSystemProjectRoles(database.client, project.id, permissionsByCode);
      const existingFixture = await database.client.contact.findFirst({
        where: { projectId: project.id, username: 'development-contact' },
      });
      if (!existingFixture)
        await database.client.contact.create({
          data: {
            displayName: 'Development Contact',
            email: 'development-contact@example.test',
            firstName: 'Development',
            projectId: project.id,
            username: 'development-contact',
          },
        });
      // A ChannelIdentity always requires a real provider connection. The seed
      // intentionally creates only a provider-neutral contact fixture; channel
      // identities are created through a configured adapter or test fixture.
    }
    process.stdout.write(
      `${JSON.stringify({
        databaseName: authorization.databaseName,
        environment: authorization.appEnvironment,
        level: 'log',
        message: 'Development/test auth and RBAC seed completed',
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
