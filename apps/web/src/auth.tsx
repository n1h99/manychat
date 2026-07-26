import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { apiRequest } from './api';

export interface Identity {
  email: string;
  firstName: string;
  globalPermissions: string[];
  globalRoleNames: string[];
  lastName: string;
  status: string;
  userId: string;
}

interface LoginResponse {
  accessToken: string;
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
  const [accessToken, setAccessToken] = useState<string>();
  const [identity, setIdentity] = useState<Identity>();
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const response = await apiRequest<LoginResponse>('/api/v1/auth/refresh', { method: 'POST' });
      setAccessToken(response.accessToken);
      setIdentity(response.user);
      return true;
    } catch {
      setAccessToken(undefined);
      setIdentity(undefined);
      return false;
    }
  }, []);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken,
      identity,
      loading,
      async login(email, password) {
        const response = await apiRequest<LoginResponse>('/api/v1/auth/login', {
          body: JSON.stringify({ email, password }),
          method: 'POST',
        });
        setAccessToken(response.accessToken);
        setIdentity(response.user);
      },
      async logout() {
        await apiRequest<void>('/api/v1/auth/logout', { method: 'POST' });
        setAccessToken(undefined);
        setIdentity(undefined);
      },
      refresh,
    }),
    [accessToken, identity, loading, refresh],
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
