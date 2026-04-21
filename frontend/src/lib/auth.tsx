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
  register: (
    name: string,
    email: string,
    password: string,
    inviteToken?: string | null,
    privacyPolicyAccepted?: boolean,
  ) => Promise<any>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Kick off the authenticated-route chunks so the browser downloads them in
// parallel with the /auth/me round trip (or with the POST /auth/login
// response). These dedupe with the React.lazy imports in App.tsx.
function prewarmAuthenticatedChunks() {
  void import('../pages/DashboardPage');
  void import('../components/CalendarView');
}

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      // Fire the authenticated-route chunk fetches before awaiting /auth/me
      // so the Calendar JS is already in flight by the time ProtectedRoute
      // resolves.
      prewarmAuthenticatedChunks();
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
    // Warm the Calendar chunk before the Navigate-to-"/" redirect fires so
    // the post-login transition doesn't wait on a cold JS fetch.
    prewarmAuthenticatedChunks();
    return res.data;
  }, []);

  const register = useCallback(async (
    name: string,
    email: string,
    password: string,
    inviteToken: string | null = null,
    privacyPolicyAccepted = false,
  ) => {
    const payload: Record<string, string | boolean> = { name, email, password };
    if (inviteToken) payload.invite_token = inviteToken;
    if (privacyPolicyAccepted) payload.privacy_policy_accepted = true;
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
