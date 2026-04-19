import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { getSocket, connectSocket, getAuthToken } from '../utils/api';
import { useAuth } from './AuthContext';

type TypingState = Record<string, any[]>;

type ChatContextType = {
  chats: any[];
  contacts: any[];
  contactRequests: { incoming: any[]; outgoing: any[] };
  typingUsers: TypingState;
  wsConnected: boolean;
  wsReconnecting: boolean;
  refreshChats: () => Promise<void>;
  refreshContacts: () => Promise<void>;
};

const ChatContext = createContext<ChatContextType>({
  chats: [],
  contacts: [],
  contactRequests: { incoming: [], outgoing: [] },
  typingUsers: {},
  wsConnected: false,
  wsReconnecting: false,
  refreshChats: async () => {},
  refreshContacts: async () => {},
});

export const useChat = () => useContext(ChatContext);

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [chats, setChats] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactRequests, setContactRequests] = useState<{ incoming: any[]; outgoing: any[] }>({
    incoming: [],
    outgoing: [],
  });
  const [typingUsers, setTypingUsers] = useState<TypingState>({});
  const [wsConnected, setWsConnected] = useState(false);
  const [wsReconnecting, setWsReconnecting] = useState(false);

  const reconnectTimerRef = useRef<any>(null);
  const mountedRef = useRef(true);

  const refreshChats = useCallback(async () => {
    try {
      const { chatsAPI } = require('../utils/api');
      const res = await chatsAPI.list();
      if (mountedRef.current) {
        setChats(res.data.chats || []);
      }
    } catch (e) {
      console.log('[ChatContext] Error loading chats', e);
    }
  }, []);

  const refreshContacts = useCallback(async () => {
    try {
      const { contactsAPI } = require('../utils/api');
      const [cRes, rRes] = await Promise.all([
        contactsAPI.list(),
        contactsAPI.requests(),
      ]);
      if (mountedRef.current) {
        setContacts(cRes.data.contacts || []);
        setContactRequests({
          incoming: rRes.data.incoming || [],
          outgoing: rRes.data.outgoing || [],
        });
      }
    } catch (e) {
      console.log('[ChatContext] Error loading contacts', e);
    }
  }, []);

  const setupSocketListeners = useCallback(() => {
    const socket = getSocket();
    if (!socket) return;

    socket.on('connect', () => {
      console.log('[ChatContext] WS connected');
      setWsConnected(true);
      setWsReconnecting(false);
      refreshChats();
      refreshContacts();
    });

    socket.on('disconnect', (reason: string) => {
      console.log('[ChatContext] WS disconnected:', reason);
      setWsConnected(false);
      if (reason === 'io server disconnect') {
        setWsReconnecting(true);
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current && user) {
            const token = getAuthToken();
            if (token) connectSocket(token);
          }
        }, 2000);
      }
    });

    socket.on('reconnect_attempt', () => {
      setWsReconnecting(true);
    });

    socket.on('reconnect', () => {
      console.log('[ChatContext] WS reconnected');
      setWsConnected(true);
      setWsReconnecting(false);
      refreshChats();
      refreshContacts();
    });

    socket.on('reconnect_failed', () => {
      setWsReconnecting(false);
    });

    socket.on('new_message', (data: { chat_id: string; message: any }) => {
      setChats((prev) => {
        const idx = prev.findIndex((c) => c.id === data.chat_id);
        if (idx === -1) return prev;
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          last_message: data.message.content || '',
          last_message_at: data.message.created_at || new Date().toISOString(),
          unread_count: (updated[idx].unread_count || 0) + 1,
        };
        return updated;
      });
    });

    socket.on('message_sent', (data: { chat_id: string; message: any }) => {
      setChats((prev) => {
        const idx = prev.findIndex((c) => c.id === data.chat_id);
        if (idx === -1) return prev;
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          last_message: data.message.content || '',
          last_message_at: data.message.created_at || new Date().toISOString(),
        };
        return updated;
      });
    });

    socket.on('chat_updated', (data: { chat_id: string; chat: any }) => {
      setChats((prev) => {
        const idx = prev.findIndex((c) => c.id === data.chat_id);
        if (idx === -1) return [...prev, data.chat];
        const updated = [...prev];
        updated[idx] = { ...updated[idx], ...data.chat };
        return updated;
      });
    });

    socket.on('chat_deleted', (data: { chat_id: string }) => {
      setChats((prev) => prev.filter((c) => c.id !== data.chat_id));
    });

    socket.on('typing_start', (data: { chat_id: string; user: any }) => {
      setTypingUsers((prev) => {
        const existing = prev[data.chat_id] || [];
        if (existing.find((u) => u.id === data.user.id)) return prev;
        return { ...prev, [data.chat_id]: [...existing, data.user] };
      });
    });

    socket.on('typing_stop', (data: { chat_id: string; user_id: string }) => {
      setTypingUsers((prev) => {
        const existing = prev[data.chat_id] || [];
        const filtered = existing.filter((u) => u.id !== data.user_id);
        if (filtered.length === 0) {
          const next = { ...prev };
          delete next[data.chat_id];
          return next;
        }
        return { ...prev, [data.chat_id]: filtered };
      });
    });

    socket.on('contact_request', (data: { request: any }) => {
      setContactRequests((prev) => ({
        ...prev,
        incoming: [...prev.incoming, data.request],
      }));
    });

    socket.on('contact_accepted', (data: { contact: any }) => {
      setContacts((prev) => [...prev, data.contact]);
      setContactRequests((prev) => ({
        ...prev,
        outgoing: prev.outgoing.filter((r) => r.id !== data.contact.request_id),
      }));
    });

    socket.on('contact_rejected', (data: { request_id: string }) => {
      setContactRequests((prev) => ({
        ...prev,
        outgoing: prev.outgoing.filter((r) => r.id !== data.request_id),
      }));
    });

    socket.on('contact_removed', (data: { contact_id: string }) => {
      setContacts((prev) => prev.filter((c) => c.id !== data.contact_id));
    });

    socket.on('presence_change', (data: { user_id: string; status: string }) => {
      setContacts((prev) =>
        prev.map((c) =>
          c.id === data.user_id ? { ...c, status: data.status } : c
        )
      );
      setChats((prev) =>
        prev.map((c) => {
          const participants = c.participants?.map((p: any) =>
            p.id === data.user_id ? { ...p, status: data.status } : p
          );
          return participants ? { ...c, participants } : c;
        })
      );
    });
  }, [refreshChats, refreshContacts, user]);

  useEffect(() => {
    mountedRef.current = true;

    if (user) {
      const socket = getSocket();
      if (socket?.connected) {
        setWsConnected(true);
        setupSocketListeners();
        refreshChats();
        refreshContacts();
      } else {
        const token = getAuthToken();
        if (token) {
          connectSocket(token);
          setupSocketListeners();
        }
      }
    }

    return () => {
      mountedRef.current = false;
      const socket = getSocket();
      if (socket) {
        socket.off('connect');
        socket.off('disconnect');
        socket.off('reconnect_attempt');
        socket.off('reconnect');
        socket.off('reconnect_failed');
        socket.off('new_message');
        socket.off('message_sent');
        socket.off('chat_updated');
        socket.off('chat_deleted');
        socket.off('typing_start');
        socket.off('typing_stop');
        socket.off('contact_request');
        socket.off('contact_accepted');
        socket.off('contact_rejected');
        socket.off('contact_removed');
        socket.off('presence_change');
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [user]);

  return (
    <ChatContext.Provider
      value={{
        chats,
        contacts,
        contactRequests,
        typingUsers,
        wsConnected,
        wsReconnecting,
        refreshChats,
        refreshContacts,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};
