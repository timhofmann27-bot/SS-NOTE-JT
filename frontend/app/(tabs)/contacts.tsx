import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, TextInput } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { contactsAPI, usersAPI, chatsAPI } from '../../src/utils/api';
import { COLORS, FONTS, SPACING, ROLES } from '../../src/utils/theme';

export default function ContactsScreen() {
  const [contacts, setContacts] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAddUsers, setShowAddUsers] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const { user } = useAuth();
  const router = useRouter();

  const loadData = useCallback(async () => {
    try {
      const [contactsRes, usersRes] = await Promise.all([contactsAPI.list(), usersAPI.list()]);
      setContacts(contactsRes.data.contacts || []);
      setAllUsers(usersRes.data.users || []);
    } catch (e) {
      console.log('Error loading contacts', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const handleAddContact = async (userId: string) => {
    setAddingId(userId);
    try {
      await contactsAPI.add(userId, 'VERIFIED');
      await loadData();
      setShowAddUsers(false);
    } catch (e: any) {
      console.log('Error adding contact', e);
    } finally {
      setAddingId(null);
    }
  };

  const handleStartChat = async (contactId: string) => {
    try {
      const res = await chatsAPI.create({ participant_ids: [contactId], is_group: false });
      router.push({ pathname: '/chat/[id]', params: { id: res.data.chat.id } });
    } catch (e) {
      console.log('Error creating chat', e);
    }
  };

  const contactIds = contacts.map((c: any) => c.id);
  const nonContacts = allUsers.filter((u: any) => !contactIds.includes(u.id));

  const filteredContacts = contacts.filter((c: any) =>
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.callsign?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredNonContacts = nonContacts.filter((u: any) =>
    u.name?.toLowerCase().includes(search.toLowerCase()) ||
    u.callsign?.toLowerCase().includes(search.toLowerCase())
  );

  const getTrustColor = (level: string) => {
    const map: any = { VERIFIED: COLORS.success, UNVERIFIED: COLORS.restricted, BLOCKED: COLORS.danger };
    return map[level] || COLORS.textMuted;
  };

  const renderContact = ({ item }: { item: any }) => {
    const roleInfo = ROLES[item.role as keyof typeof ROLES] || ROLES.soldier;
    return (
      <TouchableOpacity testID={`contact-${item.id}`} style={styles.contactItem} onPress={() => handleStartChat(item.id)} activeOpacity={0.7}>
        <View style={styles.avatarContainer}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={20} color={COLORS.textSecondary} />
          </View>
          <View style={[styles.statusDot, { backgroundColor: item.status === 'online' ? COLORS.online : COLORS.offline }]} />
        </View>
        <View style={styles.contactInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.contactName}>{item.name}</Text>
            <View style={[styles.trustBadge, { borderColor: getTrustColor(item.trust_level) }]}>
              <Ionicons name={item.trust_level === 'VERIFIED' ? 'shield-checkmark' : 'shield'} size={10} color={getTrustColor(item.trust_level)} />
            </View>
          </View>
          <Text style={styles.callsign}>{item.callsign}</Text>
          <View style={styles.roleRow}>
            <Ionicons name={roleInfo.icon as any} size={10} color={roleInfo.color} />
            <Text style={[styles.roleText, { color: roleInfo.color }]}>{roleInfo.label}</Text>
            <Text style={styles.statusText}>{item.status_text || ''}</Text>
          </View>
        </View>
        <TouchableOpacity testID={`chat-with-${item.id}`} style={styles.chatBtn} onPress={() => handleStartChat(item.id)}>
          <Ionicons name="chatbubble" size={18} color={COLORS.primaryLight} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const renderAddUser = ({ item }: { item: any }) => (
    <View style={styles.contactItem}>
      <View style={styles.avatar}>
        <Ionicons name="person-outline" size={20} color={COLORS.textMuted} />
      </View>
      <View style={[styles.contactInfo, { marginLeft: 14 }]}>
        <Text style={styles.contactName}>{item.name}</Text>
        <Text style={styles.callsign}>{item.callsign}</Text>
      </View>
      <TouchableOpacity testID={`add-contact-${item.id}`} style={styles.addBtn} onPress={() => handleAddContact(item.id)} disabled={addingId === item.id}>
        {addingId === item.id ? (
          <ActivityIndicator size="small" color={COLORS.primaryLight} />
        ) : (
          <Ionicons name="person-add" size={18} color={COLORS.primaryLight} />
        )}
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primaryLight} /></View>;
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color={COLORS.textMuted} />
        <TextInput
          testID="contact-search-input"
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Kontakte durchsuchen..."
          placeholderTextColor={COLORS.textMuted}
        />
      </View>

      <View style={styles.toggleRow}>
        <TouchableOpacity
          testID="show-contacts-btn"
          style={[styles.toggleBtn, !showAddUsers && styles.toggleActive]}
          onPress={() => setShowAddUsers(false)}
        >
          <Text style={[styles.toggleText, !showAddUsers && styles.toggleTextActive]}>KONTAKTE ({contacts.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="show-add-users-btn"
          style={[styles.toggleBtn, showAddUsers && styles.toggleActive]}
          onPress={() => setShowAddUsers(true)}
        >
          <Text style={[styles.toggleText, showAddUsers && styles.toggleTextActive]}>HINZUFÜGEN ({nonContacts.length})</Text>
        </TouchableOpacity>
      </View>

      {!showAddUsers ? (
        filteredContacts.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="people-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.emptyTitle}>Keine Kontakte</Text>
            <Text style={styles.emptySubtitle}>Füge Kontakte hinzu um zu kommunizieren</Text>
          </View>
        ) : (
          <FlatList data={filteredContacts} renderItem={renderContact} keyExtractor={(item) => item.id}
            ItemSeparatorComponent={() => <View style={styles.separator} />} />
        )
      ) : (
        filteredNonContacts.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="checkmark-circle-outline" size={48} color={COLORS.primaryLight} />
            <Text style={styles.emptyTitle}>Alle hinzugefügt</Text>
          </View>
        ) : (
          <FlatList data={filteredNonContacts} renderItem={renderAddUser} keyExtractor={(item) => item.id}
            ItemSeparatorComponent={() => <View style={styles.separator} />} />
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  searchContainer: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface,
    marginHorizontal: 16, marginTop: 12, marginBottom: 8, borderRadius: 12, paddingHorizontal: 14, height: 44,
    borderWidth: 1, borderColor: COLORS.border,
  },
  searchInput: { flex: 1, color: COLORS.textPrimary, fontSize: FONTS.sizes.md, marginLeft: 10 },
  toggleRow: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 8, gap: 8 },
  toggleBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center', backgroundColor: COLORS.surface },
  toggleActive: { backgroundColor: COLORS.primaryDark, borderWidth: 1, borderColor: COLORS.primary },
  toggleText: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold, color: COLORS.textMuted, letterSpacing: 1 },
  toggleTextActive: { color: COLORS.primaryLight },
  contactItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  avatarContainer: { position: 'relative', marginRight: 14 },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surfaceLight,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border,
  },
  statusDot: { position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: COLORS.background },
  contactInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  contactName: { fontSize: FONTS.sizes.base, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  trustBadge: { padding: 2, borderRadius: 4, borderWidth: 1 },
  callsign: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, fontWeight: FONTS.weights.medium, letterSpacing: 1, marginTop: 1 },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  roleText: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.medium },
  statusText: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, marginLeft: 4 },
  chatBtn: { padding: 10, borderRadius: 20, backgroundColor: COLORS.surfaceLight },
  addBtn: { padding: 10, borderRadius: 20, backgroundColor: COLORS.surfaceLight },
  separator: { height: 1, backgroundColor: COLORS.divider, marginLeft: 74 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyTitle: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary, marginTop: 16 },
  emptySubtitle: { fontSize: FONTS.sizes.sm, color: COLORS.textMuted, marginTop: 4, textAlign: 'center' },
});
