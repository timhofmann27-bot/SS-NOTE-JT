import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, TextInput, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../src/context/AuthContext';
import { contactsAPI, usersAPI, chatsAPI } from '../src/utils/api';
import { COLORS, FONTS, SPACING, SECURITY_LEVELS } from '../src/utils/theme';

export default function NewChatScreen() {
  const [contacts, setContacts] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [isGroup, setIsGroup] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [securityLevel, setSecurityLevel] = useState('UNCLASSIFIED');
  const [creating, setCreating] = useState(false);
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    const load = async () => {
      try {
        const [contactsRes, usersRes] = await Promise.all([contactsAPI.list(), usersAPI.list()]);
        const allUsers = [...(contactsRes.data.contacts || [])];
        const contactIds = allUsers.map((c: any) => c.id);
        const otherUsers = (usersRes.data.users || []).filter((u: any) => !contactIds.includes(u.id));
        setContacts([...allUsers, ...otherUsers]);
      } catch (e) { console.log(e); }
      finally { setLoading(false); }
    };
    load();
  }, []);

  const toggleSelect = (id: string) => {
    if (isGroup) {
      setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    } else {
      handleStartChat(id);
    }
  };

  const handleStartChat = async (contactId: string) => {
    setCreating(true);
    try {
      const res = await chatsAPI.create({ participant_ids: [contactId], is_group: false });
      router.replace({ pathname: '/chat/[id]', params: { id: res.data.chat.id } });
    } catch (e) { console.log(e); }
    finally { setCreating(false); }
  };

  const handleCreateGroup = async () => {
    if (selectedIds.length < 1 || !groupName.trim()) return;
    setCreating(true);
    try {
      const res = await chatsAPI.create({
        participant_ids: selectedIds,
        is_group: true,
        name: groupName.trim(),
        security_level: securityLevel,
      });
      router.replace({ pathname: '/chat/[id]', params: { id: res.data.chat.id } });
    } catch (e) { console.log(e); }
    finally { setCreating(false); }
  };

  const filtered = contacts.filter(c =>
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.callsign?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity testID="new-chat-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isGroup ? 'NEUE GRUPPE' : 'NEUER KANAL'}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Toggle */}
      <View style={styles.toggleRow}>
        <TouchableOpacity testID="toggle-single-btn" style={[styles.toggleBtn, !isGroup && styles.toggleActive]} onPress={() => { setIsGroup(false); setSelectedIds([]); }}>
          <Ionicons name="chatbubble" size={14} color={!isGroup ? COLORS.primaryLight : COLORS.textMuted} />
          <Text style={[styles.toggleText, !isGroup && styles.toggleTextActive]}>EINZELCHAT</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="toggle-group-btn" style={[styles.toggleBtn, isGroup && styles.toggleActive]} onPress={() => setIsGroup(true)}>
          <Ionicons name="people" size={14} color={isGroup ? COLORS.primaryLight : COLORS.textMuted} />
          <Text style={[styles.toggleText, isGroup && styles.toggleTextActive]}>GRUPPE</Text>
        </TouchableOpacity>
      </View>

      {/* Group config */}
      {isGroup && (
        <View style={styles.groupConfig}>
          <TextInput
            testID="group-name-input"
            style={styles.groupNameInput}
            value={groupName}
            onChangeText={setGroupName}
            placeholder="Gruppenname eingeben..."
            placeholderTextColor={COLORS.textMuted}
          />
          <View style={styles.secRow}>
            <Text style={styles.secLabel}>SICHERHEITSSTUFE:</Text>
            <View style={styles.secOptions}>
              {SECURITY_LEVELS.map(level => (
                <TouchableOpacity
                  key={level.key}
                  testID={`group-sec-${level.key}`}
                  style={[styles.secOption, securityLevel === level.key && { backgroundColor: `${level.color}22`, borderColor: level.color }]}
                  onPress={() => setSecurityLevel(level.key)}
                >
                  <View style={[styles.secDot, { backgroundColor: level.color }]} />
                  <Text style={[styles.secOptionText, { color: level.color }]}>{level.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          {selectedIds.length > 0 && (
            <Text style={styles.selectedCount}>{selectedIds.length} Teilnehmer ausgewählt</Text>
          )}
        </View>
      )}

      {/* Search */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color={COLORS.textMuted} />
        <TextInput
          testID="new-chat-search"
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Kontakt suchen..."
          placeholderTextColor={COLORS.textMuted}
        />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primaryLight} /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              testID={`select-contact-${item.id}`}
              style={styles.contactItem}
              onPress={() => toggleSelect(item.id)}
              disabled={creating}
            >
              <View style={styles.avatar}>
                <Ionicons name="person" size={20} color={COLORS.textSecondary} />
              </View>
              <View style={styles.contactInfo}>
                <Text style={styles.contactName}>{item.name}</Text>
                <Text style={styles.contactCallsign}>{item.callsign}</Text>
              </View>
              {isGroup && (
                <View style={[styles.checkbox, selectedIds.includes(item.id) && styles.checkboxChecked]}>
                  {selectedIds.includes(item.id) && <Ionicons name="checkmark" size={14} color={COLORS.white} />}
                </View>
              )}
              {!isGroup && (
                <Ionicons name="chatbubble-outline" size={18} color={COLORS.primaryLight} />
              )}
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}

      {/* Create Group FAB */}
      {isGroup && selectedIds.length > 0 && groupName.trim() && (
        <TouchableOpacity testID="create-group-btn" style={styles.createBtn} onPress={handleCreateGroup} disabled={creating}>
          {creating ? <ActivityIndicator color={COLORS.white} /> : (
            <>
              <Ionicons name="add-circle" size={20} color={COLORS.white} />
              <Text style={styles.createBtnText}>GRUPPE ERSTELLEN</Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 12, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  backBtn: { padding: 8 },
  headerTitle: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, letterSpacing: 1 },
  toggleRow: { flexDirection: 'row', marginHorizontal: 16, marginTop: 12, gap: 8 },
  toggleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 8, backgroundColor: COLORS.surface },
  toggleActive: { backgroundColor: COLORS.primaryDark, borderWidth: 1, borderColor: COLORS.primary },
  toggleText: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold, color: COLORS.textMuted, letterSpacing: 1 },
  toggleTextActive: { color: COLORS.primaryLight },
  groupConfig: { margin: 16, backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  groupNameInput: { color: COLORS.textPrimary, fontSize: FONTS.sizes.base, backgroundColor: COLORS.surfaceLight, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10 },
  secRow: { marginTop: 4 },
  secLabel: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold, color: COLORS.textMuted, letterSpacing: 2, marginBottom: 6 },
  secOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  secOption: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: COLORS.surfaceLight, borderWidth: 1, borderColor: COLORS.border },
  secDot: { width: 6, height: 6, borderRadius: 3 },
  secOptionText: { fontSize: 10, fontWeight: FONTS.weights.bold },
  selectedCount: { fontSize: FONTS.sizes.sm, color: COLORS.primaryLight, fontWeight: FONTS.weights.medium, marginTop: 8 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, marginHorizontal: 16, marginTop: 12, marginBottom: 8, borderRadius: 12, paddingHorizontal: 14, height: 44, borderWidth: 1, borderColor: COLORS.border },
  searchInput: { flex: 1, color: COLORS.textPrimary, fontSize: FONTS.sizes.md, marginLeft: 10 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  contactItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surfaceLight, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border, marginRight: 14 },
  contactInfo: { flex: 1 },
  contactName: { fontSize: FONTS.sizes.base, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  contactCallsign: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, letterSpacing: 1 },
  checkbox: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: COLORS.textMuted, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: COLORS.primary, borderColor: COLORS.primaryLight },
  separator: { height: 1, backgroundColor: COLORS.divider, marginLeft: 74 },
  createBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, margin: 16, borderRadius: 12, padding: 16 },
  createBtnText: { fontSize: FONTS.sizes.base, fontWeight: FONTS.weights.bold, color: COLORS.white, letterSpacing: 1 },
});
