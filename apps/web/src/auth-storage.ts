export const AUTH_STORAGE_KEY = 'omnicus-auth';

export interface Identity {
  email: string;
  firstName: string;
  globalPermissions: string[];
  globalRoleNames: string[];
  lastName: string;
  status: string;
  userId: string;
}

export interface StoredAuthSession {
  token: string;
  user: Identity;
}

type AuthStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isIdentity(value: unknown): value is Identity {
  if (typeof value !== 'object' || value === null) return false;
  const identity = value as Partial<Record<keyof Identity, unknown>>;
  return (
    typeof identity.email === 'string' &&
    typeof identity.firstName === 'string' &&
    isStringArray(identity.globalPermissions) &&
    isStringArray(identity.globalRoleNames) &&
    typeof identity.lastName === 'string' &&
    typeof identity.status === 'string' &&
    typeof identity.userId === 'string'
  );
}

export function readStoredAuthSession(
  storage: AuthStorage = globalThis.localStorage,
): StoredAuthSession | undefined {
  try {
    const raw = storage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return undefined;
    const session = value as { token?: unknown; user?: unknown };
    return typeof session.token === 'string' && session.token.length > 0 && isIdentity(session.user)
      ? { token: session.token, user: session.user }
      : undefined;
  } catch {
    return undefined;
  }
}

export function persistAuthSession(
  session: StoredAuthSession,
  storage: AuthStorage = globalThis.localStorage,
): void {
  storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredAuthSession(storage: AuthStorage = globalThis.localStorage): void {
  storage.removeItem(AUTH_STORAGE_KEY);
}
