import { describe, expect, it, vi } from 'vitest';

import {
  AUTH_STORAGE_KEY,
  clearStoredAuthSession,
  persistAuthSession,
  readStoredAuthSession,
  type StoredAuthSession,
} from './auth-storage';

const session: StoredAuthSession = {
  token: 'signed-browser-token',
  user: {
    email: 'admin@example.test',
    firstName: 'Admin',
    globalPermissions: ['projects:read'],
    globalRoleNames: ['super-admin'],
    lastName: 'User',
    status: 'ACTIVE',
    userId: 'user-a',
  },
};

function storageHarness(initial?: string) {
  let value = initial;
  return {
    getItem: vi.fn(() => value ?? null),
    removeItem: vi.fn(() => {
      value = undefined;
    }),
    setItem: vi.fn((_key: string, next: string) => {
      value = next;
    }),
  };
}

describe('persistent browser authentication', () => {
  it('stores and restores the token and user under one stable key', () => {
    const storage = storageHarness();
    persistAuthSession(session, storage);
    expect(storage.setItem).toHaveBeenCalledWith(AUTH_STORAGE_KEY, JSON.stringify(session));
    expect(readStoredAuthSession(storage)).toEqual(session);
  });

  it('rejects malformed browser state and clears the session explicitly', () => {
    const storage = storageHarness('{"token":"token","user":{"email":"missing-fields"}}');
    expect(readStoredAuthSession(storage)).toBeUndefined();
    clearStoredAuthSession(storage);
    expect(storage.removeItem).toHaveBeenCalledWith(AUTH_STORAGE_KEY);
  });
});
