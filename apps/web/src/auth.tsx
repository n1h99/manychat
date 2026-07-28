import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { ApiError, apiRequest, setUnauthorizedHandler } from './api';
import {
  clearStoredAuthSession,
  persistAuthSession,
  readStoredAuthSession,
  type Identity,
  type StoredAuthSession,
} from './auth-storage';

export type { Identity } from './auth-storage';

interface LoginResponse {
  token: string;
  user: Identity;
}

interface AuthContextValue {
  accessToken?: string | undefined;
  identity?: Identity | undefined;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<StoredAuthSession | undefined>(() =>
    readStoredAuthSession(),
  );
  const [loading, setLoading] = useState(true);

  const clearSession = useCallback(() => {
    clearStoredAuthSession();
    setSession(undefined);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(clearSession);
    if (!session) {
      setLoading(false);
      return () => setUnauthorizedHandler(undefined);
    }

    void apiRequest<Identity>('/api/v1/auth/me', {}, session.token)
      .then((user) => {
        const validated = { token: session.token, user };
        persistAuthSession(validated);
        setSession(validated);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) clearSession();
      })
      .finally(() => setLoading(false));

    return () => setUnauthorizedHandler(undefined);
  }, [clearSession, session?.token]);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!session) return false;
    try {
      const user = await apiRequest<Identity>('/api/v1/auth/me', {}, session.token);
      const validated = { token: session.token, user };
      persistAuthSession(validated);
      setSession(validated);
      return true;
    } catch {
      return false;
    }
  }, [session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken: session?.token,
      identity: session?.user,
      loading,
      async login(email, password) {
        const response = await apiRequest<LoginResponse>('/api/v1/auth/login', {
          body: JSON.stringify({ email, password }),
          method: 'POST',
        });
        const authenticated = { token: response.token, user: response.user };
        persistAuthSession(authenticated);
        setSession(authenticated);
      },
      async logout() {
        const token = session?.token;
        clearSession();
        try {
          if (token) await apiRequest<void>('/api/v1/auth/logout-all', { method: 'POST' }, token);
        } catch {
          // Local logout is authoritative even when the API is unavailable.
        }
      },
      refresh,
    }),
    [clearSession, loading, refresh, session],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
