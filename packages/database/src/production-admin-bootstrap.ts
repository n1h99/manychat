import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import * as argon2 from 'argon2';
import { config as loadEnvironment } from 'dotenv';

import { createDatabaseHandle } from './client';
import { authorizeProductionAdminBootstrap } from './production-admin-bootstrap-guard';
import { seedGlobalPermissions, seedProjectPermissions } from './seed-permissions';

loadEnvironment({ path: resolve(__dirname, '../../../.env'), quiet: true });

const auditRetentionMilliseconds = 180 * 24 * 60 * 60 * 1_000;

async function bootstrapProductionAdmin(): Promise<void> {
  const authorization = authorizeProductionAdminBootstrap(process.env);
  const database = createDatabaseHandle(authorization.databaseUrl);
  let outcome: 'already_initialized' | 'bootstrapped' = 'bootstrapped';

  try {
    await database.client.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(72319, 4121)`;

      const normalizedEmail = authorization.adminEmail.toLocaleLowerCase('en-US');
      const existingUsers = await transaction.user.findMany({
        select: { id: true, normalizedEmail: true, status: true },
        take: 2,
      });

      if (existingUsers.length > 0) {
        const existingAdmin = existingUsers.find(
          (user) => user.normalizedEmail === normalizedEmail && user.status === 'ACTIVE',
        );
        if (!existingAdmin || existingUsers.length !== 1) {
          throw new Error(
            'Production admin bootstrap refused because the database already contains users',
          );
        }

        const existingAssignment = await transaction.globalUserRole.findFirst({
          where: {
            globalRole: { normalizedName: 'super-admin', system: true },
            userId: existingAdmin.id,
          },
        });
        if (!existingAssignment) {
          throw new Error(
            'Production admin bootstrap refused to elevate an existing unassigned user',
          );
        }

        outcome = 'already_initialized';
        return;
      }

      const permissionCodes = [...seedGlobalPermissions, ...seedProjectPermissions];
      for (const code of permissionCodes) {
        await transaction.permission.upsert({
          create: { code, description: code },
          update: { description: code },
          where: { code },
        });
      }
      const permissions = await transaction.permission.findMany({
        where: { code: { in: permissionCodes } },
      });
      const permissionsByCode = new Map(
        permissions.map((permission) => [permission.code, permission.id]),
      );
      const superAdmin = await transaction.globalRole.upsert({
        create: { name: 'Super Admin', normalizedName: 'super-admin', system: true },
        update: { name: 'Super Admin', system: true },
        where: { normalizedName: 'super-admin' },
      });

      for (const code of seedGlobalPermissions) {
        const permissionId = permissionsByCode.get(code);
        if (!permissionId) {
          throw new Error('Production admin bootstrap could not resolve a required permission');
        }
        await transaction.globalRolePermission.upsert({
          create: { globalRoleId: superAdmin.id, permissionId },
          update: {},
          where: { globalRoleId_permissionId: { globalRoleId: superAdmin.id, permissionId } },
        });
      }

      const passwordHash = await argon2.hash(authorization.adminPassword, {
        type: argon2.argon2id,
      });
      const admin = await transaction.user.create({
        data: {
          email: authorization.adminEmail,
          firstName: authorization.adminFirstName,
          lastName: authorization.adminLastName,
          normalizedEmail,
          passwordHash,
        },
      });
      await transaction.globalUserRole.create({
        data: { globalRoleId: superAdmin.id, userId: admin.id },
      });
      await transaction.auditLog.create({
        data: {
          action: 'production_admin.bootstrap',
          actorEmailSnapshot: authorization.adminEmail,
          actorType: 'system-bootstrap',
          actorUserId: admin.id,
          afterSafeJson: { globalRole: 'super-admin' },
          correlationId: randomUUID(),
          entityId: admin.id,
          entityType: 'User',
          purgeAfter: new Date(Date.now() + auditRetentionMilliseconds),
          reason: 'Initial production administrator bootstrap',
        },
      });
    });

    process.stdout.write(
      `${JSON.stringify({
        databaseName: authorization.databaseName,
        environment: process.env.APP_ENV,
        message: 'Production administrator bootstrap completed',
        outcome,
        service: 'database-bootstrap',
      })}\n`,
    );
  } finally {
    await database.close();
  }
}

void bootstrapProductionAdmin().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown production administrator bootstrap failure';
  process.stderr.write(
    `${JSON.stringify({ level: 'error', message, service: 'database-bootstrap' })}\n`,
  );
  process.exitCode = 1;
});
