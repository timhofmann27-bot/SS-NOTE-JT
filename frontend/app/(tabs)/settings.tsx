import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { profileAPI, authAPI } from '../../src/utils/api';
import { COLORS, FONTS, SPACING, ROLES } from '../../src/utils/theme';

export default function SettingsScreen() {
  const { user, logout, refreshUser } = useAuth();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [callsign, setCallsign] = useState(user?.callsign || '');
  const [statusText, setStatusText] = useState(user?.status_text || '');
  const [oldPasskey, setOldPasskey] = useState('');
  const [newPasskey, setNewPasskey] = useState('');
  const [changingPk, setChangingPk] = useState(false);
  const [pkMsg, setPkMsg] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    try {
      await profileAPI.update({ name, callsign, status_text: statusText });
      await refreshUser();
      setEditing(false);
    } catch (e) {
      console.log('Error updating profile', e);
    }
  };

  const handleLogout = () => {
    logout();
    router.replace('/login');
  };

  const handleChangePasskey = async () => {
    if (!oldPasskey || !newPasskey) { setPkMsg('Fehler: Beide Felder ausfüllen'); return; }
    if (newPasskey.length < 8) { setPkMsg('Fehler: Min. 8 Zeichen'); return; }
    setChangingPk(true); setPkMsg('');
    try {
      await authAPI.changePasskey({ old_passkey: oldPasskey, new_passkey: newPasskey });
      setPkMsg('Passkey erfolgreich geändert!');
      setOldPasskey(''); setNewPasskey('');
    } catch (e: any) {
      setPkMsg('Fehler: ' + (e?.response?.data?.detail || 'Unbekannt'));
    } finally { setChangingPk(false); }
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      await authAPI.deleteAccount();
      router.replace('/login');
    } catch (e: any) {
      console.log('Delete error', e);
      setDeleting(false);
    }
  };

  const roleInfo = ROLES[(user?.role || 'soldier') as keyof typeof ROLES] || ROLES.soldier;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Profile Card */}
      <View style={styles.profileCard}>
        <View style={styles.avatarLarge}>
          <Ionicons name="person" size={40} color={COLORS.textSecondary} />
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.profileName}>{user?.name}</Text>
          <Text style={styles.profileCallsign}>{user?.callsign}</Text>
          <View style={styles.roleContainer}>
            <Ionicons name={roleInfo.icon as any} size={12} color={roleInfo.color} />
            <Text style={[styles.roleLabel, { color: roleInfo.color }]}>{roleInfo.label}</Text>
          </View>
        </View>
      </View>

      {/* Security Status */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>SICHERHEITSSTATUS</Text>
        <View style={styles.securityCard}>
          <View style={styles.secRow}>
            <Ionicons name="shield-checkmark" size={20} color={COLORS.success} />
            <View style={styles.secInfo}>
              <Text style={styles.secLabel}>Ende-zu-Ende Verschlüsselung</Text>
              <Text style={styles.secValue}>Aktiv</Text>
            </View>
          </View>
          <View style={styles.secDivider} />
          <View style={styles.secRow}>
            <Ionicons name="key" size={20} color={COLORS.primaryLight} />
            <View style={styles.secInfo}>
              <Text style={styles.secLabel}>Schlüsselaustausch</Text>
              <Text style={styles.secValue}>X3DH Protokoll</Text>
            </View>
          </View>
          <View style={styles.secDivider} />
          <View style={styles.secRow}>
            <Ionicons name="finger-print" size={20} color={COLORS.restricted} />
            <View style={styles.secInfo}>
              <Text style={styles.secLabel}>Perfect Forward Secrecy</Text>
              <Text style={styles.secValue}>Aktiviert</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Edit Profile */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>PROFIL</Text>
          <TouchableOpacity testID="edit-profile-btn" onPress={() => editing ? handleSave() : setEditing(true)}>
            <Text style={styles.editBtn}>{editing ? 'SPEICHERN' : 'BEARBEITEN'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.fieldCard}>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Name</Text>
            {editing ? (
              <TextInput testID="edit-name-input" style={styles.fieldInput} value={name} onChangeText={setName} />
            ) : (
              <Text style={styles.fieldValue}>{user?.name}</Text>
            )}
          </View>
          <View style={styles.fieldDivider} />
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Rufzeichen</Text>
            {editing ? (
              <TextInput testID="edit-callsign-input" style={styles.fieldInput} value={callsign} onChangeText={setCallsign} />
            ) : (
              <Text style={styles.fieldValue}>{user?.callsign}</Text>
            )}
          </View>
          <View style={styles.fieldDivider} />
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Status</Text>
            {editing ? (
              <TextInput testID="edit-status-input" style={styles.fieldInput} value={statusText} onChangeText={setStatusText} />
            ) : (
              <Text style={styles.fieldValue}>{user?.status_text || 'Kein Status'}</Text>
            )}
          </View>
          <View style={styles.fieldDivider} />
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Username</Text>
            <Text style={styles.fieldValue}>@{user?.username}</Text>
          </View>
        </View>
      </View>

      {/* Passkey Change */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>PASSKEY ÄNDERN</Text>
        <View style={styles.fieldCard}>
          <TextInput testID="old-passkey-input" style={styles.passkeyInput} placeholder="Alter Passkey" placeholderTextColor={COLORS.textMuted} secureTextEntry
            value={oldPasskey} onChangeText={setOldPasskey} />
          <View style={styles.fieldDivider} />
          <TextInput testID="new-passkey-input" style={styles.passkeyInput} placeholder="Neuer Passkey (min. 8 Zeichen)" placeholderTextColor={COLORS.textMuted} secureTextEntry
            value={newPasskey} onChangeText={setNewPasskey} />
          <View style={styles.fieldDivider} />
          <TouchableOpacity testID="change-passkey-btn" style={styles.changePasskeyBtn} onPress={handleChangePasskey} disabled={changingPk}>
            {changingPk ? <ActivityIndicator size="small" color={COLORS.primaryLight} /> : (
              <><Ionicons name="key" size={16} color={COLORS.primaryLight} /><Text style={styles.changePasskeyText}>Passkey ändern</Text></>
            )}
          </TouchableOpacity>
          {pkMsg ? <Text style={[styles.pkMsg, pkMsg.includes('Fehler') ? {color: COLORS.danger} : {color: COLORS.success}]}>{pkMsg}</Text> : null}
        </View>
      </View>

      {/* Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>AKTIONEN</Text>
        <TouchableOpacity testID="logout-button" style={styles.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color={COLORS.danger} />
          <Text style={styles.logoutText}>Abmelden</Text>
        </TouchableOpacity>
      </View>

      {/* DSGVO: Account Deletion */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>GEFAHRENZONE</Text>
        <TouchableOpacity testID="delete-account-btn" style={styles.deleteBtn} onPress={handleDeleteAccount} disabled={deleting}>
          {deleting ? <ActivityIndicator size="small" color={COLORS.white} /> : (
            <><Ionicons name="trash" size={18} color={COLORS.white} /><Text style={styles.deleteText}>Account & alle Daten löschen</Text></>
          )}
        </TouchableOpacity>
        <Text style={styles.deleteHint}>DSGVO Art. 17: Unwiderruflich. Alle Nachrichten, Kontakte und Chatdaten werden gelöscht.</Text>
      </View>

      <View style={styles.versionInfo}>
        <Text style={styles.versionText}>444.HEIMAT-FUNK v2.0.0</Text>
        <Text style={styles.versionSub}>DSGVO-konform | Zero-PII | BSI-Standard</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 16, paddingBottom: 40 },
  profileCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface,
    borderRadius: 16, padding: 20, borderWidth: 1, borderColor: COLORS.border,
  },
  avatarLarge: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.surfaceLight,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: COLORS.primary,
  },
  profileInfo: { marginLeft: 16, flex: 1 },
  profileName: { fontSize: FONTS.sizes.xl, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  profileCallsign: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, fontWeight: FONTS.weights.medium, letterSpacing: 2, marginTop: 2 },
  roleContainer: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  roleLabel: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold },
  section: { marginTop: 24 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold, color: COLORS.textMuted, letterSpacing: 2, marginBottom: 8 },
  editBtn: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold, color: COLORS.primaryLight, letterSpacing: 1 },
  securityCard: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  secRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  secInfo: { flex: 1 },
  secLabel: { fontSize: FONTS.sizes.md, color: COLORS.textPrimary, fontWeight: FONTS.weights.medium },
  secValue: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 1 },
  secDivider: { height: 1, backgroundColor: COLORS.divider },
  fieldCard: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  fieldLabel: { fontSize: FONTS.sizes.md, color: COLORS.textSecondary },
  fieldValue: { fontSize: FONTS.sizes.md, color: COLORS.textPrimary, fontWeight: FONTS.weights.medium },
  fieldInput: { fontSize: FONTS.sizes.md, color: COLORS.textPrimary, backgroundColor: COLORS.surfaceLight, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, minWidth: 140, textAlign: 'right' },
  fieldDivider: { height: 1, backgroundColor: COLORS.divider },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(196,75,75,0.1)', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: COLORS.danger,
  },
  logoutText: { fontSize: FONTS.sizes.base, fontWeight: FONTS.weights.semibold, color: COLORS.danger },
  passkeyInput: { color: COLORS.textPrimary, fontSize: FONTS.sizes.md, backgroundColor: COLORS.surfaceLight, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginVertical: 4 },
  changePasskeyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, marginTop: 4 },
  changePasskeyText: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.semibold, color: COLORS.primaryLight },
  pkMsg: { fontSize: FONTS.sizes.xs, textAlign: 'center', marginTop: 4 },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COLORS.danger, borderRadius: 12, padding: 16,
  },
  deleteText: { fontSize: FONTS.sizes.base, fontWeight: FONTS.weights.bold, color: COLORS.white },
  deleteHint: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, textAlign: 'center', marginTop: 8, lineHeight: 16 },
  versionInfo: { alignItems: 'center', marginTop: 32, paddingBottom: 20 },
  versionText: { fontSize: FONTS.sizes.sm, color: COLORS.textMuted },
  versionSub: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, marginTop: 2 },
});
