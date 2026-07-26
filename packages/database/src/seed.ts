import { resolve } from 'node:path';

import { config as loadEnvironment } from 'dotenv';

import { createDatabaseHandle } from './client';
import { authorizeDatabaseSeed } from './seed-guard';
import * as argon2 from 'argon2';

const globalPermissions = [
  'projects:create',
  'projects:read',
  'users:manage',
  'users:read',
  'roles:manage',
];
const projectPermissions = [
  'project:read',
  'project:manage',
  'members:manage',
  'contacts:read',
  'contacts:manage',
  'contacts:update',
  'contacts:export',
  'contacts:merge',
  'tags:read',
  'tags:manage',
  'automation:read',
  'automation:manage',
  'integrations:manage',
  'channels:read',
  'channels:manage',
  'channels:rotate_secrets',
];

const projectRoles = [
  [
    'Project Admin',
    'project-admin',
    [
      'project:read',
      'project:manage',
      'members:manage',
      'contacts:read',
      'contacts:manage',
      'contacts:update',
      'contacts:export',
      'contacts:merge',
      'tags:read',
      'tags:manage',
      'channels:read',
      'channels:manage',
      'channels:rotate_secrets',
    ],
  ],
  [
    'Automation Editor',
    'automation-editor',
    ['project:read', 'automation:read', 'automation:manage'],
  ],
  [
    'Integration Manager',
    'integration-manager',
    [
      'project:read',
      'integrations:manage',
      'channels:read',
      'channels:manage',
      'channels:rotate_secrets',
    ],
  ],
  [
    'Contact Manager',
    'contact-manager',
    [
      'project:read',
      'contacts:read',
      'contacts:manage',
      'contacts:update',
      'contacts:export',
      'contacts:merge',
      'tags:read',
      'tags:manage',
    ],
  ],
  ['Viewer', 'viewer', ['project:read', 'contacts:read', 'tags:read', 'automation:read']],
] as const;

loadEnvironment({ path: resolve(__dirname, '../../../.env'), quiet: true });

async function seed(): Promise<void> {
  const authorization = authorizeDatabaseSeed(process.env);
  const database = createDatabaseHandle(authorization.databaseUrl);

  try {
    await database.client.$queryRaw`SELECT 1`;
    const permissionCodes = [...globalPermissions, ...projectPermissions];
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
    for (const code of globalPermissions) {
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
      for (const [name, normalizedName, rolePermissions] of projectRoles) {
        const role = await database.client.projectRole.upsert({
          create: { name, normalizedName, projectId: project.id, system: true },
          update: { name, system: true },
          where: { projectId_normalizedName: { normalizedName, projectId: project.id } },
        });
        for (const permissionCode of rolePermissions) {
          const permissionId = permissionsByCode.get(permissionCode);
          if (!permissionId) {
            throw new Error(`Missing seed permission: ${permissionCode}`);
          }
          await database.client.projectRolePermission.upsert({
            create: { permissionId, projectId: project.id, projectRoleId: role.id },
            update: {},
            where: {
              projectId_projectRoleId_permissionId: {
                permissionId,
                projectId: project.id,
                projectRoleId: role.id,
              },
            },
          });
        }
      }
      const existingFixture = await database.client.contact.findFirst({
        where: { projectId: project.id, username: 'development-contact' },
      });
      const fixture =
        existingFixture ??
        (await database.client.contact.create({
          data: {
            displayName: 'Development Contact',
            email: 'development-contact@example.test',
            firstName: 'Development',
            projectId: project.id,
            username: 'development-contact',
          },
        }));
      await database.client.channelIdentity.upsert({
        create: {
          channel: 'OTHER',
          connectionId: 'development-fixture',
          contactId: fixture.id,
          externalUserId: `development-contact:${project.id}`,
          projectId: project.id,
        },
        update: {},
        where: {
          projectId_connectionId_externalUserId: {
            connectionId: 'development-fixture',
            externalUserId: `development-contact:${project.id}`,
            projectId: project.id,
          },
        },
      });
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
