import type { Request } from 'express';

export interface AuthenticatedUser {
  email: string;
  globalPermissions: string[];
  globalRoleNames: string[];
  userId: string;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthenticatedUser;
}

export function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
