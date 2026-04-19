import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authAPI, keysAPI, pushAPI, setAuthToken } from '../utils/api';
import { ensureKeyPair, getKeyFingerprint } from '../utils/crypto';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

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

async function registerPushToken() {
  try {
    if (Platform.OS === 'web') return;
    
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;
    
    const token = (await Notifications.getExpoPushTokenAsync()).data;
    await pushAPI.register(token, 'expo');
  } catch (e) {
    console.log('Push token registration failed', e);
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try { const res = await authAPI.me(); setUser(res.data.user); }
    catch { setUser(null); setAuthToken(null); }
  }, []);

  useEffect(() => {
    (async () => {
      try { const res = await authAPI.me(); setUser(res.data.user); }
      catch { setUser(null); }
      finally { setLoading(false); }
    })();
  }, []);

  // Listen for session expired events (triggered when refresh fails)
  useEffect(() => {
    const handleSessionExpired = () => {
      setUser(null);
      setLoading(false);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('auth:session_expired', handleSessionExpired);
      return () => {
        window.removeEventListener('auth:session_expired', handleSessionExpired);
      };
    }
  }, []);

  const login = async (username: string, passkey: string) => {
    const res = await authAPI.login({ username, passkey });
    setAuthToken(res.data.token);
    (global as any).__authToken = res.data.token;
    setUser(res.data.user);
    try {
      const keyPair = await ensureKeyPair();
      const fingerprint = getKeyFingerprint(keyPair.publicKey);
      await keysAPI.upload(
        btoa(String.fromCharCode(...keyPair.publicKey)),
        fingerprint
      );
    } catch (e) {
      console.log('Key upload failed, will retry later', e);
    }
    try { await registerPushToken(); } catch {}
  };

  const register = async (username: string, passkey: string, name: string, callsign?: string) => {
    const res = await authAPI.register({ username, passkey, name, callsign });
    setAuthToken(res.data.token);
    (global as any).__authToken = res.data.token;
    setUser(res.data.user);
    try {
      const keyPair = await ensureKeyPair();
      const fingerprint = getKeyFingerprint(keyPair.publicKey);
      await keysAPI.upload(
        btoa(String.fromCharCode(...keyPair.publicKey)),
        fingerprint
      );
    } catch (e) {
      console.log('Key upload failed, will retry later', e);
    }
    try { await registerPushToken(); } catch {}
  };

  const logout = async () => {
    try { await authAPI.logout(); } catch {}
    try { await pushAPI.unregister(); } catch {}
    setAuthToken(null);
    (global as any).__authToken = null;
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};
