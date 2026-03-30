import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { chatsAPI } from '../../src/utils/api';
import { COLORS, FONTS, SPACING, ROLES } from '../../src/utils/theme';

export default function ChatsScreen() {
  const [chats, setChats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const router = useRouter();

  const loadChats = useCallback(async () => {
    try {
      const res = await chatsAPI.list();
      setChats(res.data.chats || []);
    } catch (e) {
      console.log('Error loading chats', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadChats(); }, [loadChats]));

  // Poll for updates
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await chatsAPI.pollUpdates();
        setChats(res.data.chats || []);
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const getOtherParticipant = (chat: any) => {
    if (!chat.participants) return null;
    return chat.participants.find((p: any) => p.id !== user?.id) || chat.participants[0];
  };

  const getChatName = (chat: any) => {
    if (chat.is_group) return chat.name || 'Gruppe';
    const other = getOtherParticipant(chat);
    return other?.name || 'Unbekannt';
  };

  const getChatCallsign = (chat: any) => {
    if (chat.is_group) return `${chat.participants?.length || 0} Teilnehmer`;
    const other = getOtherParticipant(chat);
    return other?.callsign || '';
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

  const renderChat = ({ item }: { item: any }) => {
    const roleInfo = getRoleInfo(item);
    return (
      <TouchableOpacity
        testID={`chat-item-${item.id}`}
        style={styles.chatItem}
        onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id } })}
        activeOpacity={0.7}
      >
        <View style={styles.avatarContainer}>
          <View style={[styles.avatar, item.is_group && styles.groupAvatar]}>
            <Ionicons name={item.is_group ? 'people' : 'person'} size={22} color={COLORS.textSecondary} />
          </View>
          <View style={[styles.statusDot, { backgroundColor: getStatusColor(item) }]} />
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
            <Text style={styles.callsign}>{getChatCallsign(item)}</Text>
            {item.security_level !== 'UNCLASSIFIED' && (
              <View style={[styles.secBadge, { borderColor: getSecurityColor(item.security_level) }]}>
                <Text style={[styles.secText, { color: getSecurityColor(item.security_level) }]}>{item.security_level}</Text>
              </View>
            )}
          </View>

          <View style={styles.lastMsgRow}>
            <Ionicons name="lock-closed" size={10} color={COLORS.primaryLight} />
            <Text style={styles.lastMsg} numberOfLines={1}>{item.last_message || 'Verschlüsselter Kanal'}</Text>
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primaryLight} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {chats.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIcon}>
            <Ionicons name="radio-outline" size={48} color={COLORS.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>Keine aktiven Kanäle</Text>
          <Text style={styles.emptySubtitle}>Starte einen neuen verschlüsselten Kanal über den Kontakte-Tab</Text>
        </View>
      ) : (
        <FlatList
          data={chats}
          renderItem={renderChat}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
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
  chatItem: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 14, alignItems: 'center' },
  avatarContainer: { position: 'relative', marginRight: 14 },
  avatar: {
    width: 50, height: 50, borderRadius: 25, backgroundColor: COLORS.surfaceLight,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border,
  },
  groupAvatar: { borderColor: COLORS.primary },
  statusDot: { position: 'absolute', bottom: 1, right: 1, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: COLORS.background },
  chatInfo: { flex: 1 },
  chatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 8 },
  chatName: { fontSize: FONTS.sizes.base, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  roleBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  roleText: { fontSize: 9, fontWeight: FONTS.weights.bold, letterSpacing: 0.5 },
  chatTime: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted },
  chatSubRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  callsign: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, fontWeight: FONTS.weights.medium, letterSpacing: 1 },
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
  emptySubtitle: { fontSize: FONTS.sizes.sm, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20 },
  fab: {
    position: 'absolute', bottom: 20, right: 20, width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
    elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8,
  },
});
