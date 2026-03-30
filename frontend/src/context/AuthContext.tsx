import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authAPI, setAuthToken, connectSocket, disconnectSocket } from '../utils/api';

type User = {
  id: string;
  username: string;
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
  login: (username: string, passkey: string) => Promise<void>;
  register: (username: string, passkey: string, name: string, callsign?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null, loading: true,
  login: async () => {}, register: async () => {}, logout: async () => {}, refreshUser: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try { const res = await authAPI.me(); setUser(res.data.user); }
    catch { setUser(null); setAuthToken(null); disconnectSocket(); }
  }, []);

  useEffect(() => {
    (async () => {
      try { const res = await authAPI.me(); setUser(res.data.user); }
      catch { setUser(null); }
      finally { setLoading(false); }
    })();
  }, []);

  const login = async (username: string, passkey: string) => {
    const res = await authAPI.login({ username, passkey });
    setAuthToken(res.data.token);
    setUser(res.data.user);
    try { connectSocket(res.data.token); } catch {}
  };

  const register = async (username: string, passkey: string, name: string, callsign?: string) => {
    const res = await authAPI.register({ username, passkey, name, callsign });
    setAuthToken(res.data.token);
    setUser(res.data.user);
    try { connectSocket(res.data.token); } catch {}
  };

  const logout = async () => {
    try { await authAPI.logout(); } catch {}
    disconnectSocket();
    setAuthToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};
