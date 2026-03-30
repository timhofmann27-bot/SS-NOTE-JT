import axios from 'axios';
import { io, Socket } from 'socket.io-client';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

const api = axios.create({
  baseURL: `${BACKEND_URL}/api`,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

let authToken: string | null = null;
let socket: Socket | null = null;

export const setAuthToken = (token: string | null) => {
  authToken = token;
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common['Authorization'];
  }
};

export const getAuthToken = () => authToken;

// WebSocket connection management
export const connectSocket = (token: string): Socket => {
  if (socket?.connected) return socket;
  socket = io(BACKEND_URL, {
    path: '/api/socket.io',
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionAttempts: 10,
  });
  socket.on('connect', () => console.log('[WS] Connected'));
  socket.on('disconnect', () => console.log('[WS] Disconnected'));
  socket.on('connect_error', (e) => console.log('[WS] Error:', e.message));
  return socket;
};

export const disconnectSocket = () => {
  socket?.disconnect();
  socket = null;
};

export const getSocket = () => socket;

// Auth (Anonymous: Username + Passkey)
export const authAPI = {
  register: (data: { username: string; passkey: string; name: string; callsign?: string }) =>
    api.post('/auth/register', data),
  login: (data: { username: string; passkey: string }) =>
    api.post('/auth/login', data),
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
  changePasskey: (data: { old_passkey: string; new_passkey: string }) =>
    api.post('/auth/change-passkey', data),
  generateUsername: () => api.get('/auth/generate-username'),
  refresh: () => api.post('/auth/refresh'),
  deleteAccount: () => api.delete('/auth/account'),
};

export const usersAPI = {
  list: () => api.get('/users'),
  get: (id: string) => api.get(`/users/${id}`),
};

export const profileAPI = {
  update: (data: any) => api.put('/profile', data),
};

export const contactsAPI = {
  list: () => api.get('/contacts'),
  add: (userId: string, trustLevel?: string) =>
    api.post('/contacts/add', { user_id: userId, trust_level: trustLevel || 'UNVERIFIED' }),
  remove: (contactId: string) => api.delete(`/contacts/${contactId}`),
};

export const chatsAPI = {
  list: () => api.get('/chats'),
  create: (data: any) => api.post('/chats', data),
  get: (id: string) => api.get(`/chats/${id}`),
  pollUpdates: () => api.get('/chats/poll/updates'),
  leave: (id: string) => api.post(`/chats/${id}/leave`),
};

export const messagesAPI = {
  list: (chatId: string, limit?: number) => api.get(`/messages/${chatId}`, { params: { limit } }),
  send: (data: any) => api.post('/messages', data),
  markRead: (messageIds: string[]) => api.post('/messages/read', { message_ids: messageIds }),
  poll: (chatId: string, after?: string) => api.get(`/messages/poll/${chatId}`, { params: { after } }),
  delete: (id: string) => api.delete(`/messages/${id}`),
};

export const typingAPI = {
  set: (chatId: string) => api.post(`/typing/${chatId}`),
  get: (chatId: string) => api.get(`/typing/${chatId}`),
};

export default api;
