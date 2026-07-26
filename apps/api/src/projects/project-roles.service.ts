import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@omnicus/database';

import { systemProjectRoles } from '../access/permissions';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class ProjectRolesService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async ensureForProject(
    projectId: string,
    transaction: Prisma.TransactionClient = this.database.client,
  ): Promise<Map<string, string>> {
    const permissions = await transaction.permission.findMany({
      where: { code: { in: systemProjectRoles.flatMap((role) => [...role.permissions]) } },
    });
    const permissionIds = new Map(
      permissions.map((permission) => [permission.code, permission.id]),
    );
    const roles = new Map<string, string>();
    for (const definition of systemProjectRoles) {
      const role = await transaction.projectRole.upsert({
        create: {
          name: definition.name,
          normalizedName: definition.normalizedName,
          projectId,
          system: true,
        },
        update: { name: definition.name, system: true },
        where: {
          projectId_normalizedName: { normalizedName: definition.normalizedName, projectId },
        },
      });
      for (const permissionCode of definition.permissions) {
        const permissionId = permissionIds.get(permissionCode);
        if (!permissionId) {
          throw new Error(`Required system permission is missing: ${permissionCode}`);
        }
        await transaction.projectRolePermission.upsert({
          create: { permissionId, projectId, projectRoleId: role.id },
          update: {},
          where: {
            projectId_projectRoleId_permissionId: {
              permissionId,
              projectId,
              projectRoleId: role.id,
            },
          },
        });
      }
      roles.set(definition.normalizedName, role.id);
    }
    return roles;
  }
}
