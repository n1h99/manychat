import { Inject, Injectable } from '@nestjs/common';

import { projectPermissions, SUPER_ADMIN_ROLE } from './permissions';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class AccessService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async isSessionActive(userId: string, sessionId: string): Promise<boolean> {
    const session = await this.database.client.session.findFirst({
      select: { id: true },
      where: {
        expiresAt: { gt: new Date() },
        id: sessionId,
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
        userId,
      },
    });
    return session !== null;
  }

  async getGlobalAccess(userId: string): Promise<{ permissions: string[]; roleNames: string[] }> {
    const user = await this.database.client.user.findUnique({
      select: { status: true },
      where: { id: userId },
    });
    if (!user || user.status !== 'ACTIVE') {
      return { permissions: [], roleNames: [] };
    }
    const assignments = await this.database.client.globalUserRole.findMany({
      include: {
        globalRole: { include: { permissions: { include: { permission: true } } } },
      },
      where: { userId },
    });
    return {
      permissions: [
        ...new Set(
          assignments.flatMap((assignment) =>
            assignment.globalRole.permissions.map((entry) => entry.permission.code),
          ),
        ),
      ],
      roleNames: assignments.map((assignment) => assignment.globalRole.normalizedName),
    };
  }

  async hasProjectPermission(
    userId: string,
    projectId: string,
    permission: string,
  ): Promise<boolean> {
    const globalAccess = await this.getGlobalAccess(userId);
    if (globalAccess.roleNames.includes(SUPER_ADMIN_ROLE)) {
      return true;
    }
    const membership = await this.database.client.projectMembership.findUnique({
      include: { projectRole: { include: { permissions: { include: { permission: true } } } } },
      where: { projectId_userId: { projectId, userId } },
    });
    return Boolean(
      membership?.status === 'ACTIVE' &&
      membership.projectRole.permissions.some((entry) => entry.permission.code === permission),
    );
  }

  async getProjectAccess(
    userId: string,
    projectId: string,
  ): Promise<{ permissions: string[]; projectRoleName: string | null }> {
    const globalAccess = await this.getGlobalAccess(userId);
    if (globalAccess.roleNames.includes(SUPER_ADMIN_ROLE)) {
      return { permissions: [...projectPermissions], projectRoleName: null };
    }
    const membership = await this.database.client.projectMembership.findUnique({
      include: { projectRole: { include: { permissions: { include: { permission: true } } } } },
      where: { projectId_userId: { projectId, userId } },
    });
    if (!membership || membership.status !== 'ACTIVE') {
      return { permissions: [], projectRoleName: null };
    }
    return {
      permissions: [
        ...new Set(membership.projectRole.permissions.map((entry) => entry.permission.code)),
      ],
      projectRoleName: membership.projectRole.normalizedName,
    };
  }
}
