import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import {
  sanitizeDisplayText,
  sanitizeUsername,
  sanitizeGroupName,
  sanitizeStatusText,
  sanitizeMessageContent,
  sanitizeCallsign,
  sanitizeSearchQuery,
} from './sanitization';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

const api = axios.create({
  baseURL: `${BACKEND_URL}/api`,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor: sanitize all outgoing payloads
api.interceptors.request.use((config) => {
  if (config.data && typeof config.data === 'object') {
    const sanitized = sanitizePayload(config.data);
    config.data = sanitized;
  }
  return config;
});

/**
 * Recursively sanitize all string values in a payload object.
 * This is a safety net — specific fields should be sanitized at the UI layer too.
 */
function sanitizePayload(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    return sanitizeDisplayText(obj, 10000);
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizePayload(item));
  }
  if (typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Apply field-specific sanitization
      if (key === 'username') {
        result[key] = sanitizeUsername(value as string);
      } else if (key === 'name' && typeof value === 'string') {
        result[key] = sanitizeDisplayText(value as string, 100);
      } else if (key === 'callsign') {
        result[key] = sanitizeCallsign(value as string);
      } else if (key === 'status_text') {
        result[key] = sanitizeStatusText(value as string);
      } else if (key === 'content' && typeof value === 'string') {
        result[key] = sanitizeMessageContent(value as string);
      } else if (key === 'question' && typeof value === 'string') {
        result[key] = sanitizeDisplayText(value as string, 500);
      } else if (key === 'options' && Array.isArray(value)) {
        result[key] = value.map((opt: string) => sanitizeDisplayText(opt, 200));
      } else {
        result[key] = sanitizePayload(value);
      }
    }
    return result;
  }
  return obj;
}

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
  
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
  }

  socket = io(BACKEND_URL, {
    path: '/api/socket.io',
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    reconnectionAttempts: Infinity,
  });

  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
};

export const getSocket = () => socket;

export const emitTyping = (chatId: string) => {
  socket?.emit('typing:start', { chat_id: chatId });
};

export const emitStopTyping = (chatId: string) => {
  socket?.emit('typing:stop', { chat_id: chatId });
};

// Auth (Anonymous: Username + Passkey)
export const authAPI = {
  register: (data: { username: string; passkey: string; name: string; callsign?: string }) =>
    api.post('/auth/register', {
      ...data,
      username: sanitizeUsername(data.username),
      name: sanitizeDisplayText(data.name, 100),
      callsign: data.callsign ? sanitizeCallsign(data.callsign) : undefined,
    }),
  login: (data: { username: string; passkey: string }) =>
    api.post('/auth/login', {
      ...data,
      username: sanitizeUsername(data.username),
    }),
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
  changePasskey: (data: { old_passkey: string; new_passkey: string }) =>
    api.post('/auth/change-passkey', data),
  generateUsername: () => api.get('/auth/generate-username'),
  refresh: () => api.post('/auth/refresh'),
  deleteAccount: () => api.delete('/auth/account'),
  createMagicQR: () => api.post('/auth/magic-qr'),
  verifyMagicToken: (token: string) => api.post('/auth/magic-verify', { token }),
};

export const usersAPI = {
  list: () => api.get('/users'),
  get: (id: string) => api.get(`/users/${id}`),
};

export const profileAPI = {
  update: (data: {
    name?: string;
    callsign?: string;
    status_text?: string;
    avatar_base64?: string;
  }) =>
    api.put('/profile', {
      name: data.name ? sanitizeDisplayText(data.name, 100) : data.name,
      callsign: data.callsign ? sanitizeCallsign(data.callsign) : data.callsign,
      status_text: data.status_text ? sanitizeStatusText(data.status_text) : data.status_text,
      avatar_base64: data.avatar_base64,
    }),
};

export const contactsAPI = {
  list: () => api.get('/contacts'),
  requests: () => api.get('/contacts/requests'),
  addByCode: (code: string) => api.post('/contacts/add-by-code', { code: code.trim().toUpperCase() }),
  acceptRequest: (id: string) => api.post(`/contacts/request/${id}/accept`),
  rejectRequest: (id: string) => api.post(`/contacts/request/${id}/reject`),
  remove: (contactId: string) => api.delete(`/contacts/${contactId}`),
  getMyCode: () => api.get('/users/my-add-code'),
  resetCode: () => api.post('/users/reset-add-code'),
};

export const chatsAPI = {
  list: (params?: { limit?: number; cursor?: string }) =>
    api.get('/chats', { params: { limit: params?.limit, cursor: params?.cursor } }),
  create: (data: { participant_ids: string[]; name?: string; is_group?: boolean; security_level?: string }) =>
    api.post('/chats', {
      ...data,
      name: data.name ? sanitizeGroupName(data.name) : data.name,
    }),
  get: (id: string) => api.get(`/chats/${id}`),
  pollUpdates: () => api.get('/chats/poll/updates'),
  leave: (id: string) => api.post(`/chats/${id}/leave`),
  addMember: (id: string, contactId: string) => api.post(`/chats/${id}/add-member`, { contact_id: contactId }),
  removeMember: (id: string, memberId: string) => api.post(`/chats/${id}/remove-member`, { member_id: memberId }),
  update: (id: string, data: { name?: string; security_level?: string }) =>
    api.put(`/chats/${id}`, {
      name: data.name ? sanitizeGroupName(data.name) : data.name,
      security_level: data.security_level,
    }),
  pinMessage: (id: string, messageId: string) => api.post(`/chats/${id}/pin-message`, { message_id: messageId }),
  unpinMessage: (id: string) => api.post(`/chats/${id}/unpin-message`),
  export: (id: string) => api.post(`/chats/${id}/export`),
  promoteAdmin: (id: string, memberId: string) => api.post(`/chats/${id}/promote-admin`, { member_id: memberId }),
  demoteAdmin: (id: string, memberId: string) => api.post(`/chats/${id}/demote-admin`, { member_id: memberId }),
  getAdmins: (id: string) => api.get(`/chats/${id}/admins`),
};

export const messagesAPI = {
  list: (chatId: string, limit?: number) => api.get(`/messages/${chatId}`, { params: { limit } }),
  send: (data: { chat_id: string; content: string; message_type?: string; security_level?: string }) =>
    api.post('/messages', {
      ...data,
      content: sanitizeMessageContent(data.content),
    }),
  markRead: (messageIds: string[]) => api.post('/messages/read', { message_ids: messageIds }),
  poll: (chatId: string, after?: string) => api.get(`/messages/poll/${chatId}`, { params: { after } }),
  delete: (id: string) => api.delete(`/messages/${id}`),
  edit: (id: string, content: string) =>
    api.put(`/messages/${id}`, { content: sanitizeMessageContent(content) }),
  react: (id: string, emoji: string) => api.post(`/messages/${id}/react`, { emoji }),
  star: (id: string) => api.post(`/messages/${id}/star`),
  getStarred: (chatId: string) => api.get(`/messages/starred/${chatId}`),
  search: (chatId: string, q: string) =>
    api.get(`/messages/search/${chatId}`, { params: { q: sanitizeSearchQuery(q) } }),
  forward: (id: string, chatId: string) => api.post(`/messages/${id}/forward`, { chat_id: chatId }),
  getMentions: () => api.get('/messages/mentions'),
  getMentionCount: () => api.get('/messages/mentions/unread-count'),
  createPoll: (chatId: string, question: string, options: string[]) =>
    api.post(`/chats/${chatId}/polls`, {
      question: sanitizeDisplayText(question, 500),
      options: options.map(opt => sanitizeDisplayText(opt, 200)),
    }),
  getPolls: (chatId: string) => api.get(`/chats/${chatId}/polls`),
  getPoll: (pollId: string) => api.get(`/polls/${pollId}`),
  votePoll: (pollId: string, optionIndex: number) => api.post(`/polls/${pollId}/vote`, { option_index: optionIndex }),
};

export const typingAPI = {
  set: (chatId: string) => api.post(`/typing/${chatId}`),
  get: (chatId: string) => api.get(`/typing/${chatId}`),
};

export const keysAPI = {
  upload: (publicKey: string, fingerprint?: string) =>
    api.post('/keys/upload', { public_key: publicKey, fingerprint }),
  get: (userId: string) => api.get(`/keys/${userId}`),
  getBatch: (userIds: string[]) => api.get('/keys/batch', { params: { user_ids: userIds.join(',') } }),
  uploadPrekeys: (data: {
    signed_prekey_id: string;
    signed_prekey: string;
    signature: string;
    identity_key: string;
    one_time_prekeys: { id: string; key: string }[];
  }) => api.post('/keys/prekeys', data),
  getPrekeyBundle: (userId: string) => api.get(`/keys/prekeys/${userId}`),
  consumePrekey: (userId: string, otpId: string) => api.delete(`/keys/prekeys/${userId}/${otpId}`),
};

export const pushAPI = {
  register: (pushToken: string, platform: string = 'expo') =>
    api.post('/push/register', { push_token: pushToken, platform }),
  unregister: () => api.delete('/push/unregister'),
};

export const statusAPI = {
  create: (content: string, mediaBase64?: string | null) =>
    api.post('/status', { content: sanitizeStatusText(content), media_base64: mediaBase64 }),
  get: () => api.get('/status'),
  getMy: () => api.get('/status/my'),
  delete: (id: string) => api.delete(`/status/${id}`),
};

export const encryptedMessagesAPI = {
  send: (data: {
    chat_id: string;
    ciphertext: string;
    nonce: string;
    dh_public?: string | null;
    msg_num?: number;
    message_type?: string;
    security_level?: string;
    self_destruct_seconds?: number | null;
    is_emergency?: boolean;
  }) => api.post('/messages/encrypted', data),
  sendPairwise: (data: {
    chat_id: string;
    message_type: string;
    security_level: string;
    self_destruct_seconds?: number | null;
    is_emergency?: boolean;
    reply_to?: string | null;
    recipients: { user_id: string; ciphertext: string; nonce: string; dh_public?: string | null; msg_num?: number; media_ciphertext?: string | null; media_nonce?: string | null }[];
  }) => api.post('/messages/encrypted-pairwise', data),
};

export default api;
