import axios from 'axios';
import { Platform } from 'react-native';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

const api = axios.create({
  baseURL: `${BACKEND_URL}/api`,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

let authToken: string | null = null;

export const setAuthToken = (token: string | null) => {
  authToken = token;
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common['Authorization'];
  }
};

export const getAuthToken = () => authToken;

// Auth
export const authAPI = {
  register: (data: { email: string; password: string; name: string; callsign?: string }) =>
    api.post('/auth/register', data),
  login: (data: { email: string; password: string }) =>
    api.post('/auth/login', data),
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
};

// Users
export const usersAPI = {
  list: () => api.get('/users'),
  get: (id: string) => api.get(`/users/${id}`),
};

// Profile
export const profileAPI = {
  update: (data: any) => api.put('/profile', data),
};

// Contacts
export const contactsAPI = {
  list: () => api.get('/contacts'),
  add: (userId: string, trustLevel?: string) =>
    api.post('/contacts/add', { user_id: userId, trust_level: trustLevel || 'UNVERIFIED' }),
  remove: (contactId: string) => api.delete(`/contacts/${contactId}`),
};

// Chats
export const chatsAPI = {
  list: () => api.get('/chats'),
  create: (data: any) => api.post('/chats', data),
  get: (id: string) => api.get(`/chats/${id}`),
  pollUpdates: () => api.get('/chats/poll/updates'),
};

// Messages
export const messagesAPI = {
  list: (chatId: string, limit?: number) => api.get(`/messages/${chatId}`, { params: { limit } }),
  send: (data: any) => api.post('/messages', data),
  markRead: (messageIds: string[]) => api.post('/messages/read', { message_ids: messageIds }),
  poll: (chatId: string, after?: string) => api.get(`/messages/poll/${chatId}`, { params: { after } }),
};

// Typing
export const typingAPI = {
  set: (chatId: string) => api.post(`/typing/${chatId}`),
  get: (chatId: string) => api.get(`/typing/${chatId}`),
};

export default api;
