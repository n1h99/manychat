import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedRequest } from '../auth/auth.types';
import { AccessService } from './access.service';
import { REQUIRED_GLOBAL_PERMISSION, REQUIRED_PROJECT_PERMISSION } from './access.decorators';
import { SUPER_ADMIN_ROLE } from './permissions';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const globalPermission = this.reflector.getAllAndOverride<string>(REQUIRED_GLOBAL_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    const projectPermission = this.reflector.getAllAndOverride<string>(
      REQUIRED_PROJECT_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & { params: { projectId?: string } }>();
    const auth = request.auth;
    if (!auth) {
      return false;
    }
    const superAdmin = auth.globalRoleNames.includes(SUPER_ADMIN_ROLE);
    if (globalPermission && !superAdmin && !auth.globalPermissions.includes(globalPermission)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Global permission is required' });
    }
    if (projectPermission) {
      const projectId = request.params.projectId;
      if (
        !projectId ||
        !(await this.access.hasProjectPermission(auth.userId, projectId, projectPermission))
      ) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Project permission is required',
        });
      }
    }
    return true;
  }
}
