import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { authAPI } from './api';
import { resetPostHog } from './consent';

interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<any>;
  register: (name: string, email: string, password: string, inviteToken?: string | null) => Promise<any>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      try {
        const res = await authAPI.me();
        const userData: AuthUser = {
          id: res.data.user_id,
          name: res.data.name,
          email: res.data.email,
          role: res.data.role
        };
        setUser(userData);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    initAuth();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authAPI.login({ email, password });
    setUser(res.data.user);
    return res.data;
  }, []);

  const register = useCallback(async (name: string, email: string, password: string, inviteToken: string | null = null) => {
    const payload: Record<string, string> = { name, email, password };
    if (inviteToken) payload.invite_token = inviteToken;
    const res = await authAPI.register(payload);
    if (res.data.user) {
      setUser(res.data.user);
    }
    return res.data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authAPI.logout();
    } catch {
      // Ignore logout errors
    }
    // Clear analytics identity before dropping the user state so no further
    // events are attributed to the previous session.
    await resetPostHog();
    setUser(null);
  }, []);

  const contextValue = useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout]
  );

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be inside AuthProvider');
  return context;
}
