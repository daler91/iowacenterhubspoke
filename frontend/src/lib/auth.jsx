import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { authAPI } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      try {
        const res = await authAPI.me();
        const userData = { 
          id: res.data.user_id, 
          name: res.data.name, 
          email: res.data.email, 
          role: res.data.role 
        };
        setUser(userData);
        localStorage.setItem('auth_user', JSON.stringify(userData));
      } catch {
        localStorage.removeItem('auth_user');
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    initAuth();
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await authAPI.login({ email, password });
    localStorage.setItem('auth_user', JSON.stringify(res.data.user));
    setUser(res.data.user);
    return res.data;
  }, []);

  const register = useCallback(async (name, email, password, inviteToken = null) => {
    const payload = { name, email, password };
    if (inviteToken) payload.invite_token = inviteToken;
    const res = await authAPI.register(payload);
    if (res.data.token && res.data.user) {
      localStorage.setItem('auth_user', JSON.stringify(res.data.user));
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
    localStorage.removeItem('auth_user');
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

AuthProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be inside AuthProvider');
  return context;
}
