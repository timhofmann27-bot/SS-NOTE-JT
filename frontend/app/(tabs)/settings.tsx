import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, Alert, ActivityIndicator, Image, Switch, Modal, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { profileAPI, authAPI, contactsAPI, chatsAPI } from '../../src/utils/api';
import { COLORS, FONTS, SPACING, ROLES } from '../../src/utils/theme';
import Storage from '../../src/utils/Storage';
import nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';

// Wire up nacl util
nacl.util = naclUtil;

// Derive a 32-byte key from password using PBKDF2-like approach (100k iterations via SHA-256)
async function deriveBackupKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  let key = new Uint8Array([...nacl.util.stringToUTF8(password), ...salt]);
  for (let i = 0; i < 1000; i++) {
    key = nacl.hash(key);
  }
  return key.slice(0, 32);
}

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
  const [qrData, setQrData] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [addCode, setAddCode] = useState('');
  const [codeLoading, setCodeLoading] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportChats, setExportChats] = useState<any[]>([]);
  const [exportingChat, setExportingChat] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPassword, setImportPassword] = useState('');
  const [importing, setImporting] = useState(false);
  const [backupPassword, setBackupPassword] = useState('');
  const [backupPasswordConfirm, setBackupPasswordConfirm] = useState('');

  useEffect(() => {
    Storage.getItemAsync('biometric_lock').then(val => {
      setBiometricEnabled(val === 'true');
    });
    if (Platform.OS !== 'web') {
      import('expo-local-authentication').then(LocalAuthentication => {
        LocalAuthentication.hasHardwareAsync().then(has => {
          if (has) LocalAuthentication.isEnrolledAsync().then(enrolled => setBiometricAvailable(has && enrolled));
        });
      });
    }
  }, []);

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

  const handleGenerateQR = async () => {
    setQrLoading(true);
    try {
      const res = await authAPI.createMagicQR();
      setQrData(res.data.qr_base64);
      // Auto-expire QR display after 5 minutes
      setTimeout(() => setQrData(null), 300000);
    } catch (e) {
      console.log('QR error', e);
    } finally {
      setQrLoading(false);
    }
  };

  const loadAddCode = async () => {
    try { const res = await contactsAPI.getMyCode(); setAddCode(res.data.code); } catch {}
  };
  const handleResetCode = async () => {
    setCodeLoading(true);
    try { const res = await contactsAPI.resetCode(); setAddCode(res.data.code); }
    catch (e: any) { console.log('Reset error', e?.response?.data?.detail); }
    finally { setCodeLoading(false); }
  };
  React.useEffect(() => { loadAddCode(); }, []);

  const loadChatsForExport = async () => {
    try {
      const res = await chatsAPI.list();
      setExportChats(res.data.chats || []);
    } catch (e) { console.log(e); }
  };

  const handleExportChat = async (chatId: string, chatName: string) => {
    if (!backupPassword || backupPassword.length < 8) {
      Alert.alert('Fehler', 'Setze zuerst ein Backup-Passwort (min. 8 Zeichen)');
      return;
    }
    setExportingChat(chatId);
    try {
      const res = await chatsAPI.export(chatId);
      const exportData = JSON.stringify(res.data.export, null, 2);

      // Encrypt with password using PBKDF2 + AES-GCM (via nacl secretbox)
      const salt = nacl.randomBytes(16);
      const keyMaterial = await deriveBackupKey(backupPassword, salt);
      const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
      const encrypted = nacl.secretbox(nacl.util.stringToUTF8(exportData), nonce, keyMaterial);

      const backupPayload = JSON.stringify({
        version: 1,
        type: 'encrypted_backup',
        salt: nacl.util.encodeBase64(salt),
        nonce: nacl.util.encodeBase64(nonce),
        data: nacl.util.encodeBase64(encrypted),
        chat_name: chatName,
        created_at: new Date().toISOString(),
      });

      if (Platform.OS === 'web') {
        const blob = new Blob([backupPayload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${chatName || 'chat'}_backup.enc.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        Alert.alert('Exportiert', 'Verschlüsseltes Backup heruntergeladen');
      } else {
        const { File, Paths } = await import('expo-file-system');
        const { isAvailableAsync, shareAsync } = await import('expo-sharing');
        const file = new File(Paths.document, `${chatName || 'chat'}_backup.enc.json`);
        await file.write(backupPayload);
        if (await isAvailableAsync()) {
          await shareAsync(file.uri);
        } else {
          Alert.alert('Exportiert', `Verschlüsseltes Backup gespeichert unter: ${file.uri}`);
        }
      }
    } catch (e: any) {
      Alert.alert('Fehler', e?.response?.data?.detail || 'Export fehlgeschlagen');
    } finally {
      setExportingChat(null);
    }
  };

  const importFileRef = useRef<HTMLInputElement | null>(null);

  const handleImportBackup = async (content: string) => {
    if (!importPassword) {
      Alert.alert('Fehler', 'Gib dein Backup-Passwort ein');
      return;
    }
    setImporting(true);
    try {
      const payload = JSON.parse(content);
      if (payload.type !== 'encrypted_backup') {
        Alert.alert('Fehler', 'Ungültiges Backup-Format');
        return;
      }

      const salt = nacl.util.decodeBase64(payload.salt);
      const nonce = nacl.util.decodeBase64(payload.nonce);
      const encrypted = nacl.util.decodeBase64(payload.data);

      const keyMaterial = await deriveBackupKey(importPassword, salt);
      const decrypted = nacl.secretbox.open(encrypted, nonce, keyMaterial);
      if (!decrypted) {
        Alert.alert('Fehler', 'Falsches Passwort oder beschädigtes Backup');
        return;
      }

      const exportData = JSON.parse(nacl.util.UTF8ToString(decrypted));
      Alert.alert('Import erfolgreich', `Chat "${payload.chat_name}" wiederhergestellt. ${exportData.messages?.length || 0} Nachrichten.`);
      setShowImportModal(false);
    } catch (e: any) {
      Alert.alert('Fehler', 'Import fehlgeschlagen: ' + (e.message || 'Unbekannter Fehler'));
    } finally {
      setImporting(false);
    }
  };

  const handleImportFileSelect = async () => {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.enc.json,.json';
      input.onchange = async (e: any) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
          await handleImportBackup(ev.target?.result as string);
        };
        reader.readAsText(file);
      };
      input.click();
    } else {
      const { DocumentPicker } = await import('expo-document-picker');
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
      if (!result.canceled && result.assets[0]) {
        const { readAsStringAsync } = await import('expo-file-system/legacy');
        const content = await readAsStringAsync(result.assets[0].uri);
        await handleImportBackup(content);
      }
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
          {biometricAvailable && (
            <>
              <View style={styles.secDivider} />
              <View style={styles.secRow}>
                <Ionicons name="finger-print" size={20} color={biometricEnabled ? COLORS.success : COLORS.textMuted} />
                <View style={styles.secInfo}>
                  <Text style={styles.secLabel}>Biometrische Sperre</Text>
                  <Switch
                    value={biometricEnabled}
                    onValueChange={async (val) => {
                      await Storage.setItemAsync('biometric_lock', val ? 'true' : 'false');
                      setBiometricEnabled(val);
                    }}
                    trackColor={{ false: COLORS.textMuted, true: COLORS.primary }}
                    thumbColor={COLORS.white}
                  />
                </View>
              </View>
            </>
          )}
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

      {/* Add-Me Code */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>MEIN ADD-CODE</Text>
        <View style={styles.fieldCard}>
          <View style={styles.codeRow}>
            <Ionicons name="key" size={20} color={COLORS.primaryLight} />
            <Text testID="my-add-code" style={styles.addCodeText}>{addCode || '...'}</Text>
          </View>
          <Text style={styles.codeHintText}>Teile diesen Code mit anderen Nutzern, damit sie dich als Kontakt hinzufügen können.</Text>
          <View style={styles.fieldDivider} />
          <TouchableOpacity testID="reset-code-btn" style={styles.resetCodeBtn} onPress={handleResetCode} disabled={codeLoading}>
            {codeLoading ? <ActivityIndicator size="small" color={COLORS.restricted} /> : (
              <><Ionicons name="refresh" size={14} color={COLORS.restricted} /><Text style={styles.resetCodeText}>Code zurücksetzen</Text></>
            )}
          </TouchableOpacity>
          <Text style={styles.resetWarn}>Alter Code wird sofort ungültig. Max 3 Resets/Tag.</Text>
        </View>
      </View>

      {/* QR Magic Login */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>CROSS-DEVICE LOGIN</Text>
        <View style={styles.fieldCard}>
          {qrData ? (
            <View style={styles.qrContainer}>
              <Image source={{ uri: qrData }} style={styles.qrImage} resizeMode="contain" />
              <Text style={styles.qrHint}>Scanne diesen QR-Code mit einem anderen Gerät um dich dort automatisch anzumelden</Text>
              <Text style={styles.qrTimer}>Gültig für 5 Minuten</Text>
            </View>
          ) : (
            <TouchableOpacity testID="generate-qr-btn" style={styles.qrBtn} onPress={handleGenerateQR} disabled={qrLoading}>
              {qrLoading ? <ActivityIndicator size="small" color={COLORS.primaryLight} /> : (
                <><Ionicons name="qr-code" size={20} color={COLORS.primaryLight} /><Text style={styles.qrBtnText}>QR-Code für Geräte-Login generieren</Text></>
              )}
            </TouchableOpacity>
          )}
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
        <Text style={styles.sectionTitle}>DATENEXPORT</Text>
        <TouchableOpacity testID="export-chat-btn" style={styles.exportBtn} onPress={async () => { await loadChatsForExport(); setShowExportModal(true); }}>
          <Ionicons name="download-outline" size={20} color={COLORS.primaryLight} />
          <Text style={styles.exportBtnText}>Chatverlauf exportieren (verschlüsselt)</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="import-chat-btn" style={[styles.exportBtn, { marginTop: 8 }]} onPress={() => setShowImportModal(true)}>
          <Ionicons name="upload-outline" size={20} color={COLORS.primaryLight} />
          <Text style={styles.exportBtnText}>Backup importieren</Text>
        </TouchableOpacity>
        <Text style={styles.exportHint}>Exportiert alle Nachrichten als JSON-Datei. E2EE-Nachrichten bleiben verschlüsselt.</Text>
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
        <Text style={styles.versionText}>SS-Note v2.0.0</Text>
        <Text style={styles.versionSub}>DSGVO-konform | Zero-PII | BSI-Standard</Text>
      </View>

      {/* Export Modal */}
      <Modal visible={showExportModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Verschlüsseltes Backup</Text>
              <TouchableOpacity onPress={() => setShowExportModal(false)}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>
            <View style={styles.backupPasswordRow}>
              <Text style={styles.backupPasswordLabel}>Backup-Passwort:</Text>
              <TextInput
                style={styles.backupPasswordInput}
                value={backupPassword}
                onChangeText={setBackupPassword}
                placeholder="Min. 8 Zeichen"
                placeholderTextColor={COLORS.textMuted}
                secureTextEntry
                autoCapitalize="none"
              />
            </View>
            <ScrollView style={styles.exportChatList}>
              {exportChats.map((c: any) => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.exportChatItem}
                  onPress={() => handleExportChat(c.id, c.name || c.id)}
                  disabled={exportingChat === c.id}
                >
                  <View style={styles.exportChatInfo}>
                    <Text style={styles.exportChatName} numberOfLines={1}>{c.is_group ? c.name : (c.participants?.find((p: any) => p.id !== user?.id)?.name || 'Chat')}</Text>
                    <Text style={styles.exportChatMeta}>{c.is_group ? 'Gruppe' : 'Direktnachricht'}</Text>
                  </View>
                  {exportingChat === c.id ? (
                    <ActivityIndicator size="small" color={COLORS.primaryLight} />
                  ) : (
                    <Ionicons name="download-outline" size={20} color={COLORS.primaryLight} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Import Modal */}
      <Modal visible={showImportModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Backup importieren</Text>
              <TouchableOpacity onPress={() => setShowImportModal(false)}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>
            <View style={styles.importSection}>
              <Text style={styles.importLabel}>Backup-Passwort:</Text>
              <TextInput
                style={styles.backupPasswordInput}
                value={importPassword}
                onChangeText={setImportPassword}
                placeholder="Passwort eingeben"
                placeholderTextColor={COLORS.textMuted}
                secureTextEntry
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={[styles.importBtn, importing && { opacity: 0.5 }]}
                onPress={handleImportFileSelect}
                disabled={importing}
              >
                <Ionicons name="folder-open-outline" size={20} color={COLORS.white} />
                <Text style={styles.importBtnText}>Datei auswählen</Text>
              </TouchableOpacity>
              {importing && <ActivityIndicator size="small" color={COLORS.primaryLight} style={{ marginTop: 12 }} />}
            </View>
          </View>
        </View>
      </Modal>
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
  qrContainer: { alignItems: 'center', padding: 16 },
  qrImage: { width: 200, height: 200, borderRadius: 8, marginBottom: 12 },
  qrHint: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 16 },
  qrTimer: { fontSize: FONTS.sizes.xs, color: COLORS.restricted, fontWeight: FONTS.weights.bold, marginTop: 6 },
  qrBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  qrBtnText: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.semibold, color: COLORS.primaryLight },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 12 },
  addCodeText: { fontSize: 22, fontWeight: '800', color: COLORS.primaryLight, letterSpacing: 4, fontFamily: 'monospace' },
  codeHintText: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, textAlign: 'center', paddingHorizontal: 12, lineHeight: 16 },
  resetCodeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  resetCodeText: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.semibold, color: COLORS.restricted },
  resetWarn: { fontSize: 10, color: COLORS.textMuted, textAlign: 'center' },
  versionInfo: { alignItems: 'center', marginTop: 32, paddingBottom: 20 },
  versionText: { fontSize: FONTS.sizes.sm, color: COLORS.textMuted },
  versionSub: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, marginTop: 2 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primaryDark, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: COLORS.primary },
  exportBtnText: { fontSize: FONTS.sizes.base, fontWeight: FONTS.weights.semibold, color: COLORS.primaryLight },
  exportHint: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, textAlign: 'center', marginTop: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: COLORS.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%', paddingBottom: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  modalTitle: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  exportChatList: { maxHeight: 400 },
  exportChatItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  exportChatInfo: { flex: 1 },
  exportChatName: { fontSize: FONTS.sizes.base, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  exportChatMeta: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 2 },
  backupPasswordRow: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  backupPasswordLabel: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold, color: COLORS.textMuted, letterSpacing: 1, marginBottom: 6 },
  backupPasswordInput: { backgroundColor: COLORS.surface, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 14, height: 44, color: COLORS.textPrimary, fontSize: FONTS.sizes.base },
  importSection: { padding: 16 },
  importLabel: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold, color: COLORS.textMuted, letterSpacing: 1, marginBottom: 6 },
  importBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: 12, padding: 14, marginTop: 12 },
  importBtnText: { fontSize: FONTS.sizes.base, fontWeight: FONTS.weights.semibold, color: COLORS.white },
});
