import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { useChat } from '../../src/context/ChatContext';
import { chatsAPI } from '../../src/utils/api';
import { COLORS, FONTS, SPACING, ROLES } from '../../src/utils/theme';

const PAGE_SIZE = 20;

export default function ChatsScreen() {
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [allChats, setAllChats] = useState<any[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const { user } = useAuth();
  const { chats, isConnected, refreshChats } = useChat();
  const router = useRouter();
  const loadingRef = useRef(false);

  const loadChats = useCallback(async (cursor?: string | null, append = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;

    try {
      if (!cursor) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      const res = await chatsAPI.list({ limit: PAGE_SIZE, cursor: cursor || undefined });
      const newChats = res.data.chats || [];
      const returnedCursor = res.data.next_cursor || null;
      const returnedHasMore = res.data.has_more || false;

      if (append) {
        setAllChats((prev) => {
          const existingIds = new Set(prev.map((c) => c.id));
          const uniqueNew = newChats.filter((c: any) => !existingIds.has(c.id));
          return [...prev, ...uniqueNew];
        });
      } else {
        setAllChats(newChats);
      }

      setNextCursor(returnedCursor);
      setHasMore(returnedHasMore);
    } catch (e) {
      console.log('Error loading chats', e);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      loadingRef.current = false;
    }
  }, []);

  const loadMore = useCallback(() => {
    if (!loadingMore && hasMore && nextCursor) {
      loadChats(nextCursor, true);
    }
  }, [loadingMore, hasMore, nextCursor, loadChats]);

  useFocusEffect(
    useCallback(() => {
      setAllChats([]);
      setNextCursor(null);
      setHasMore(true);
      loadChats(null, false);
    }, [loadChats])
  );

  const getOtherParticipant = (chat: any) => {
    if (!chat.participants) return null;
    return chat.participants.find((p: any) => p.id !== user?.id) || chat.participants[0];
  };

  const getChatName = (chat: any) => {
    if (chat.is_group) return chat.name || 'Gruppe';
    const other = getOtherParticipant(chat);
    return other?.name || 'Unbekannt';
  };

  const getChatSubtitle = (chat: any) => {
    if (chat.is_group) {
      const count = chat.participants?.length || 0;
      return `${count} Teilnehmer${count > 1 ? 'innen' : ''}`;
    }
    const other = getOtherParticipant(chat);
    return other?.status === 'online' ? 'Online' : 'Offline';
  };

  const getStatusColor = (chat: any) => {
    if (chat.is_group) return COLORS.primary;
    const other = getOtherParticipant(chat);
    return other?.status === 'online' ? COLORS.online : COLORS.offline;
  };

  const getRoleInfo = (chat: any) => {
    if (chat.is_group) return null;
    const other = getOtherParticipant(chat);
    const role = other?.role || 'soldier';
    return ROLES[role as keyof typeof ROLES] || ROLES.soldier;
  };

  const formatTime = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHrs = diffMs / (1000 * 60 * 60);
    if (diffHrs < 24) {
      return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  };

  const getSecurityColor = (level: string) => {
    const map: any = { UNCLASSIFIED: COLORS.unclassified, RESTRICTED: COLORS.restricted, CONFIDENTIAL: COLORS.confidential, SECRET: COLORS.secret };
    return map[level] || COLORS.unclassified;
  };

  const getGroupInitials = (chat: any) => {
    if (!chat.is_group || !chat.name) return '';
    return chat.name.split(' ').map((w: string) => w[0]).join('').substring(0, 2).toUpperCase();
  };

  const getContactInitial = (chat: any) => {
    const other = getOtherParticipant(chat);
    return other?.name?.charAt(0).toUpperCase() || '?';
  };

  const getAvatarColor = (id: string) => {
    const colors = [COLORS.primary, '#4A90D9', '#7B68EE', '#20B2AA', '#FF6B6B', '#FFD93D', '#6BCB77'];
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const renderChat = ({ item }: { item: any }) => {
    const roleInfo = getRoleInfo(item);
    const avatarColor = getAvatarColor(item.id);
    const isGroup = item.is_group;

    return (
      <TouchableOpacity
        testID={`chat-item-${item.id}`}
        style={styles.chatItem}
        onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id } })}
        activeOpacity={0.7}
      >
        <View style={styles.avatarContainer}>
          <View style={[styles.avatar, isGroup && styles.groupAvatar, { backgroundColor: isGroup ? `${avatarColor}33` : COLORS.surfaceLight, borderColor: isGroup ? avatarColor : COLORS.border }]}>
            {isGroup ? (
              <Text style={[styles.avatarInitial, { color: avatarColor }]}>{getGroupInitials(item)}</Text>
            ) : (
              <Text style={styles.avatarInitial}>{getContactInitial(item)}</Text>
            )}
          </View>
          {!isGroup && <View style={[styles.statusDot, { backgroundColor: getStatusColor(item) }]} />}
        </View>

        <View style={styles.chatInfo}>
          <View style={styles.chatHeader}>
            <View style={styles.nameRow}>
              <Text style={styles.chatName} numberOfLines={1}>{getChatName(item)}</Text>
              {roleInfo && (
                <View style={[styles.roleBadge, { backgroundColor: `${roleInfo.color}22` }]}>
                  <Text style={[styles.roleText, { color: roleInfo.color }]}>{roleInfo.label}</Text>
                </View>
              )}
            </View>
            <Text style={styles.chatTime}>{formatTime(item.last_message_at)}</Text>
          </View>

          <View style={styles.chatSubRow}>
            <View style={styles.subLeft}>
              <Ionicons name={isGroup ? 'people' : item.participants?.[0]?.status === 'online' ? 'circle' : 'ellipse-outline'} size={10} color={getStatusColor(item)} />
              <Text style={styles.callsign}>{getChatSubtitle(item)}</Text>
            </View>
            {item.security_level !== 'UNCLASSIFIED' && (
              <View style={[styles.secBadge, { borderColor: getSecurityColor(item.security_level) }]}>
                <Text style={[styles.secText, { color: getSecurityColor(item.security_level) }]}>{item.security_level}</Text>
              </View>
            )}
          </View>

          <View style={styles.lastMsgRow}>
            <Ionicons name="lock-closed" size={10} color={COLORS.textMuted} />
            <Text style={styles.lastMsg} numberOfLines={1}>{item.last_message || (isGroup ? 'Gruppenchat erstellt' : 'Verschlüsselter Kanal')}</Text>
            {(item.unread_count || 0) > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadText}>{item.unread_count}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={COLORS.primaryLight} />
      </View>
    );
  };

  const renderEmpty = () => {
    if (loading) return null;
    return (
      <View style={styles.emptyContainer}>
        <View style={styles.emptyIcon}>
          <Ionicons name="chatbubbles-outline" size={48} color={COLORS.textMuted} />
        </View>
        <Text style={styles.emptyTitle}>Noch keine Chats</Text>
        <Text style={styles.emptySubtitle}>Erstelle einen neuen Chat oder eine Gruppe</Text>
        <TouchableOpacity
          testID="empty-new-chat-btn"
          style={styles.emptyCta}
          onPress={() => router.push('/new-chat')}
        >
          <Ionicons name="add" size={18} color={COLORS.white} />
          <Text style={styles.emptyCtaText}>Neuen Chat starten</Text>
        </TouchableOpacity>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primaryLight} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline" size={14} color={COLORS.warning} />
          <Text style={styles.offlineText}>Verbindung getrennt – Warte auf Reconnect...</Text>
        </View>
      )}
      {allChats.length === 0 ? (
        renderEmpty()
      ) : (
        <FlatList
          data={allChats}
          renderItem={renderChat}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={renderFooter}
        />
      )}

      <TouchableOpacity
        testID="new-chat-fab"
        style={styles.fab}
        onPress={() => router.push('/new-chat')}
      >
        <Ionicons name="create" size={24} color={COLORS.white} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  listContent: { paddingVertical: 8 },
  offlineBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6, backgroundColor: `${COLORS.warning}15`, borderBottomWidth: 1, borderBottomColor: `${COLORS.warning}30` },
  offlineText: { fontSize: FONTS.sizes.xs, color: COLORS.warning, fontWeight: FONTS.weights.medium },
  chatItem: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
  avatarContainer: { position: 'relative', marginRight: 14 },
  avatar: {
    width: 50, height: 50, borderRadius: 25,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  groupAvatar: { borderRadius: 14 },
  avatarInitial: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.bold, color: COLORS.textSecondary },
  statusDot: { position: 'absolute', bottom: 1, right: 1, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: COLORS.background },
  chatInfo: { flex: 1 },
  chatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 8 },
  chatName: { fontSize: FONTS.sizes.base, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  roleBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  roleText: { fontSize: 9, fontWeight: FONTS.weights.bold, letterSpacing: 0.5 },
  chatTime: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted },
  chatSubRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2 },
  subLeft: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  callsign: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, fontWeight: FONTS.weights.medium },
  secBadge: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3, borderWidth: 1 },
  secText: { fontSize: 8, fontWeight: FONTS.weights.bold, letterSpacing: 0.5 },
  lastMsgRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  lastMsg: { flex: 1, fontSize: FONTS.sizes.sm, color: COLORS.textMuted },
  unreadBadge: {
    backgroundColor: COLORS.primaryLight, borderRadius: 10, minWidth: 20, height: 20,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  unreadText: { fontSize: 10, fontWeight: FONTS.weights.bold, color: COLORS.white },
  separator: { height: 1, backgroundColor: COLORS.divider, marginLeft: 80 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary, marginBottom: 8 },
  emptySubtitle: { fontSize: FONTS.sizes.sm, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  emptyCta: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12 },
  emptyCtaText: { fontSize: FONTS.sizes.base, fontWeight: FONTS.weights.bold, color: COLORS.white },
  fab: {
    position: 'absolute', bottom: 20, right: 20, width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
    elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8,
  },
  footerLoader: { paddingVertical: 20, alignItems: 'center' },
});
