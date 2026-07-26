import { SetMetadata } from '@nestjs/common';

export const REQUIRED_GLOBAL_PERMISSION = 'omnicus:required-global-permission';
export const REQUIRED_PROJECT_PERMISSION = 'omnicus:required-project-permission';

export const RequireGlobalPermission = (permission: string) =>
  SetMetadata(REQUIRED_GLOBAL_PERMISSION, permission);
export const RequireProjectPermission = (permission: string) =>
  SetMetadata(REQUIRED_PROJECT_PERMISSION, permission);
