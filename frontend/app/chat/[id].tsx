import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList,
  KeyboardAvoidingView, Platform, ActivityIndicator
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { messagesAPI, chatsAPI, typingAPI } from '../../src/utils/api';
import { COLORS, FONTS, SPACING, SECURITY_LEVELS } from '../../src/utils/theme';

export default function ChatDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const [chat, setChat] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState<any[]>([]);
  const [securityLevel, setSecurityLevel] = useState('UNCLASSIFIED');
  const [showSecMenu, setShowSecMenu] = useState(false);
  const [selfDestruct, setSelfDestruct] = useState<number | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const typingTimer = useRef<any>(null);
  const lastMsgId = useRef<string | null>(null);

  const loadChat = useCallback(async () => {
    if (!id) return;
    try {
      const [chatRes, msgsRes] = await Promise.all([
        chatsAPI.get(id), messagesAPI.list(id, 50),
      ]);
      setChat(chatRes.data.chat);
      setMessages(msgsRes.data.messages || []);
      if (msgsRes.data.messages?.length > 0) {
        lastMsgId.current = msgsRes.data.messages[msgsRes.data.messages.length - 1].id;
        // Mark as read
        const unread = msgsRes.data.messages
          .filter((m: any) => m.sender_id !== user?.id && !m.read_by?.includes(user?.id))
          .map((m: any) => m.id);
        if (unread.length > 0) messagesAPI.markRead(unread);
      }
    } catch (e) {
      console.log('Error loading chat', e);
    } finally {
      setLoading(false);
    }
  }, [id, user]);

  useEffect(() => { loadChat(); }, [loadChat]);

  // Poll for new messages
  useEffect(() => {
    if (!id) return;
    const interval = setInterval(async () => {
      try {
        const res = await messagesAPI.poll(id, lastMsgId.current || undefined);
        if (res.data.messages?.length > 0) {
          setMessages(prev => {
            const existingIds = new Set(prev.map(m => m.id));
            const newMsgs = res.data.messages.filter((m: any) => !existingIds.has(m.id));
            if (newMsgs.length === 0) return prev;
            return [...prev, ...newMsgs];
          });
          const lastNew = res.data.messages[res.data.messages.length - 1];
          lastMsgId.current = lastNew.id;
          // Mark new messages as read
          const unread = res.data.messages
            .filter((m: any) => m.sender_id !== user?.id)
            .map((m: any) => m.id);
          if (unread.length > 0) messagesAPI.markRead(unread);
        }
        // Check typing
        const typRes = await typingAPI.get(id);
        setTypingUsers(typRes.data.typing || []);
      } catch {}
    }, 2000);
    return () => clearInterval(interval);
  }, [id, user]);

  const handleSend = async () => {
    if (!text.trim() || !id) return;
    setSending(true);
    try {
      const res = await messagesAPI.send({
        chat_id: id,
        content: text.trim(),
        security_level: securityLevel,
        self_destruct_seconds: selfDestruct,
      });
      setMessages(prev => [...prev, res.data.message]);
      lastMsgId.current = res.data.message.id;
      setText('');
      setSelfDestruct(null);
    } catch (e) {
      console.log('Error sending message', e);
    } finally {
      setSending(false);
    }
  };

  const handleTyping = () => {
    if (!id) return;
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingAPI.set(id).catch(() => {});
    typingTimer.current = setTimeout(() => {}, 3000);
  };

  const getOtherParticipant = () => {
    if (!chat?.participants) return null;
    return chat.participants.find((p: any) => p.id !== user?.id) || chat.participants[0];
  };

  const getChatTitle = () => {
    if (chat?.is_group) return chat.name || 'Gruppe';
    return getOtherParticipant()?.name || 'Chat';
  };

  const getChatSubtitle = () => {
    if (chat?.is_group) return `${chat.participants?.length || 0} Teilnehmer`;
    const other = getOtherParticipant();
    return other?.status === 'online' ? 'Online' : 'Offline';
  };

  const getSecColor = (level: string) => {
    const found = SECURITY_LEVELS.find(s => s.key === level);
    return found?.color || COLORS.unclassified;
  };

  const getStatusIcon = (msg: any) => {
    if (msg.sender_id !== user?.id) return null;
    const participantCount = (chat?.participants?.length || 2) - 1;
    const readCount = (msg.read_by?.length || 0) - 1;
    const deliveredCount = (msg.delivered_to?.length || 0);
    if (readCount >= participantCount) return { name: 'checkmark-done', color: COLORS.primaryLight };
    if (deliveredCount >= participantCount) return { name: 'checkmark-done', color: COLORS.textMuted };
    return { name: 'checkmark', color: COLORS.textMuted };
  };

  const formatTime = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  };

  const renderMessage = ({ item, index }: { item: any; index: number }) => {
    const isMine = item.sender_id === user?.id;
    const statusIcon = getStatusIcon(item);
    const isEmergency = item.is_emergency;
    const showSenderName = chat?.is_group && !isMine;

    // Show date separator
    const showDate = index === 0 || (
      new Date(item.created_at).toDateString() !== new Date(messages[index - 1]?.created_at).toDateString()
    );

    return (
      <View>
        {showDate && (
          <View style={styles.dateSeparator}>
            <Text style={styles.dateText}>
              {new Date(item.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })}
            </Text>
          </View>
        )}
        <View style={[styles.msgRow, isMine ? styles.msgRowRight : styles.msgRowLeft]}>
          <View style={[
            styles.msgBubble,
            isMine ? styles.sentBubble : styles.receivedBubble,
            isEmergency && styles.emergencyBubble,
          ]}>
            {isEmergency && (
              <View style={styles.emergencyBanner}>
                <Ionicons name="alert-circle" size={12} color={COLORS.danger} />
                <Text style={styles.emergencyText}>NOTFALL</Text>
              </View>
            )}
            {showSenderName && (
              <Text style={styles.senderName}>{item.sender_callsign || item.sender_name}</Text>
            )}
            {item.security_level !== 'UNCLASSIFIED' && (
              <View style={[styles.msgSecBadge, { borderColor: getSecColor(item.security_level) }]}>
                <Text style={[styles.msgSecText, { color: getSecColor(item.security_level) }]}>{item.security_level}</Text>
              </View>
            )}
            <Text style={styles.msgContent}>{item.content}</Text>
            <View style={styles.msgFooter}>
              {item.encrypted && <Ionicons name="lock-closed" size={9} color={COLORS.primaryLight} />}
              {item.self_destruct_seconds && (
                <View style={styles.destructBadge}>
                  <Ionicons name="timer" size={9} color={COLORS.restricted} />
                  <Text style={styles.destructText}>{item.self_destruct_seconds}s</Text>
                </View>
              )}
              <Text style={styles.msgTime}>{formatTime(item.created_at)}</Text>
              {statusIcon && <Ionicons name={statusIcon.name as any} size={14} color={statusIcon.color} />}
            </View>
          </View>
        </View>
      </View>
    );
  };

  if (loading) {
    return <View style={styles.loadingContainer}><ActivityIndicator size="large" color={COLORS.primaryLight} /></View>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity testID="chat-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.headerTitle} numberOfLines={1}>{getChatTitle()}</Text>
            <Ionicons name="lock-closed" size={12} color={COLORS.primaryLight} />
          </View>
          <Text style={styles.headerSubtitle}>{getChatSubtitle()}</Text>
        </View>
        <View style={[styles.secIndicator, { backgroundColor: `${getSecColor(chat?.security_level || 'UNCLASSIFIED')}22`, borderColor: getSecColor(chat?.security_level || 'UNCLASSIFIED') }]}>
          <Text style={[styles.secIndicatorText, { color: getSecColor(chat?.security_level || 'UNCLASSIFIED') }]}>E2E</Text>
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex} keyboardVerticalOffset={0}>
        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messagesList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyMessages}>
              <Ionicons name="lock-closed" size={32} color={COLORS.textMuted} />
              <Text style={styles.emptyText}>Verschlüsselter Kanal bereit</Text>
              <Text style={styles.emptySubtext}>Nachrichten sind Ende-zu-Ende verschlüsselt</Text>
            </View>
          }
        />

        {/* Typing indicator */}
        {typingUsers.length > 0 && (
          <View style={styles.typingBar}>
            <Text style={styles.typingText}>{typingUsers.map(t => t.name).join(', ')} tippt...</Text>
          </View>
        )}

        {/* Security level selector */}
        {showSecMenu && (
          <View style={styles.secMenu}>
            {SECURITY_LEVELS.map(level => (
              <TouchableOpacity
                key={level.key}
                testID={`sec-level-${level.key}`}
                style={[styles.secMenuItem, securityLevel === level.key && { backgroundColor: `${level.color}22` }]}
                onPress={() => { setSecurityLevel(level.key); setShowSecMenu(false); }}
              >
                <View style={[styles.secDot, { backgroundColor: level.color }]} />
                <Text style={[styles.secMenuText, { color: level.color }]}>{level.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              testID="self-destruct-toggle"
              style={[styles.secMenuItem, selfDestruct && { backgroundColor: `${COLORS.restricted}22` }]}
              onPress={() => setSelfDestruct(selfDestruct ? null : 30)}
            >
              <Ionicons name="timer" size={14} color={COLORS.restricted} />
              <Text style={[styles.secMenuText, { color: COLORS.restricted }]}>
                {selfDestruct ? `Selbstzerstörung: ${selfDestruct}s` : 'Selbstzerstörung'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Input */}
        <View style={styles.inputBar}>
          <TouchableOpacity testID="security-menu-btn" onPress={() => setShowSecMenu(!showSecMenu)} style={styles.secBtn}>
            <Ionicons name="shield" size={20} color={getSecColor(securityLevel)} />
          </TouchableOpacity>
          <View style={styles.inputContainer}>
            <TextInput
              testID="message-input"
              style={styles.input}
              value={text}
              onChangeText={(t) => { setText(t); handleTyping(); }}
              placeholder="Nachricht verschlüsseln..."
              placeholderTextColor={COLORS.textMuted}
              multiline
              maxLength={4000}
            />
          </View>
          <TouchableOpacity
            testID="send-message-btn"
            style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!text.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Ionicons name="send" size={18} color={COLORS.white} />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  
  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 12,
    backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: { padding: 8 },
  headerInfo: { flex: 1, marginLeft: 4 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  headerSubtitle: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 1 },
  secIndicator: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, marginRight: 8 },
  secIndicatorText: { fontSize: 10, fontWeight: FONTS.weights.bold, letterSpacing: 1 },

  // Messages
  messagesList: { padding: 12, paddingBottom: 4 },
  msgRow: { marginBottom: 6, maxWidth: '82%' },
  msgRowRight: { alignSelf: 'flex-end' },
  msgRowLeft: { alignSelf: 'flex-start' },
  msgBubble: { borderRadius: 16, padding: 10, paddingBottom: 6 },
  sentBubble: { backgroundColor: COLORS.sentBubble, borderBottomRightRadius: 4 },
  receivedBubble: { backgroundColor: COLORS.receivedBubble, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: COLORS.border },
  emergencyBubble: { backgroundColor: COLORS.emergency, borderColor: COLORS.danger, borderWidth: 1 },
  emergencyBanner: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  emergencyText: { fontSize: 10, fontWeight: FONTS.weights.bold, color: COLORS.danger, letterSpacing: 1 },
  senderName: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold, color: COLORS.primaryLight, marginBottom: 2 },
  msgSecBadge: { alignSelf: 'flex-start', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3, borderWidth: 1, marginBottom: 4 },
  msgSecText: { fontSize: 8, fontWeight: FONTS.weights.bold, letterSpacing: 0.5 },
  msgContent: { fontSize: FONTS.sizes.md, color: COLORS.textPrimary, lineHeight: 20 },
  msgFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 4 },
  msgTime: { fontSize: 10, color: COLORS.textMuted },
  destructBadge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  destructText: { fontSize: 9, color: COLORS.restricted },

  // Date separator
  dateSeparator: { alignItems: 'center', marginVertical: 12 },
  dateText: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, backgroundColor: COLORS.surface, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10 },

  // Empty
  emptyMessages: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 100 },
  emptyText: { fontSize: FONTS.sizes.base, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary, marginTop: 12 },
  emptySubtext: { fontSize: FONTS.sizes.sm, color: COLORS.textMuted, marginTop: 4 },

  // Typing
  typingBar: { paddingHorizontal: 16, paddingVertical: 4 },
  typingText: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, fontStyle: 'italic' },

  // Security menu
  secMenu: {
    backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border,
    paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 6,
  },
  secMenuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    backgroundColor: COLORS.surfaceLight,
  },
  secDot: { width: 8, height: 8, borderRadius: 4 },
  secMenuText: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold, letterSpacing: 0.5 },

  // Input
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 8, paddingVertical: 8,
    backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  secBtn: { padding: 10 },
  inputContainer: {
    flex: 1, backgroundColor: COLORS.inputBg, borderRadius: 20,
    borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 16,
    maxHeight: 100, minHeight: 40, justifyContent: 'center',
  },
  input: { color: COLORS.textPrimary, fontSize: FONTS.sizes.md, paddingVertical: 8 },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center', marginLeft: 6,
  },
  sendBtnDisabled: { opacity: 0.4 },
});
