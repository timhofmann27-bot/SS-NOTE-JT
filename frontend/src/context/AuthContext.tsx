import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authAPI, setAuthToken } from '../utils/api';

type User = {
  id: string;
  email: string;
  name: string;
  callsign: string;
  role: string;
  status: string;
  status_text: string;
  avatar_base64: string | null;
} | null;

type AuthContextType = {
  user: User;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, callsign?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  refreshUser: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const res = await authAPI.me();
      setUser(res.data.user);
    } catch {
      setUser(null);
      setAuthToken(null);
    }
  }, []);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await authAPI.me();
        setUser(res.data.user);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    check();
  }, []);

  const login = async (email: string, password: string) => {
    const res = await authAPI.login({ email, password });
    setAuthToken(res.data.token);
    setUser(res.data.user);
  };

  const register = async (email: string, password: string, name: string, callsign?: string) => {
    const res = await authAPI.register({ email, password, name, callsign });
    setAuthToken(res.data.token);
    setUser(res.data.user);
  };

  const logout = async () => {
    try { await authAPI.logout(); } catch {}
    setAuthToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};
