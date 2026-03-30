import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../src/context/AuthContext';
import { COLORS, FONTS, SPACING } from '../src/utils/theme';

export default function RegisterScreen() {
  const [name, setName] = useState('');
  const [callsign, setCallsign] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const router = useRouter();

  const handleRegister = async () => {
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError('Bitte alle Pflichtfelder ausfüllen');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwörter stimmen nicht überein');
      return;
    }
    if (password.length < 6) {
      setError('Passwort muss mindestens 6 Zeichen haben');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await register(email, password, name, callsign || undefined);
      router.replace('/(tabs)/chats');
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Registrierung fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <Ionicons name="person-add" size={32} color={COLORS.primaryLight} />
            </View>
            <Text style={styles.title}>REGISTRIERUNG</Text>
            <Text style={styles.subtitle}>Neuen Zugang erstellen</Text>
          </View>

          <View style={styles.form}>
            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="warning" size={16} color={COLORS.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Text style={styles.label}>NAME *</Text>
            <View style={styles.inputContainer}>
              <Ionicons name="person-outline" size={18} color={COLORS.textMuted} style={styles.inputIcon} />
              <TextInput testID="register-name-input" style={styles.input} value={name} onChangeText={setName}
                placeholder="Vor- und Nachname" placeholderTextColor={COLORS.textMuted} />
            </View>

            <Text style={styles.label}>RUFZEICHEN</Text>
            <View style={styles.inputContainer}>
              <Ionicons name="flag-outline" size={18} color={COLORS.textMuted} style={styles.inputIcon} />
              <TextInput testID="register-callsign-input" style={styles.input} value={callsign} onChangeText={setCallsign}
                placeholder="z.B. WOLF-1" placeholderTextColor={COLORS.textMuted} autoCapitalize="characters" />
            </View>

            <Text style={styles.label}>KENNUNG (E-MAIL) *</Text>
            <View style={styles.inputContainer}>
              <Ionicons name="mail-outline" size={18} color={COLORS.textMuted} style={styles.inputIcon} />
              <TextInput testID="register-email-input" style={styles.input} value={email} onChangeText={setEmail}
                placeholder="kennung@heimatfunk.de" placeholderTextColor={COLORS.textMuted}
                keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
            </View>

            <Text style={styles.label}>PASSWORT *</Text>
            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed-outline" size={18} color={COLORS.textMuted} style={styles.inputIcon} />
              <TextInput testID="register-password-input" style={styles.input} value={password} onChangeText={setPassword}
                placeholder="Min. 6 Zeichen" placeholderTextColor={COLORS.textMuted} secureTextEntry />
            </View>

            <Text style={styles.label}>PASSWORT BESTÄTIGEN *</Text>
            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed-outline" size={18} color={COLORS.textMuted} style={styles.inputIcon} />
              <TextInput testID="register-confirm-password-input" style={styles.input} value={confirmPassword} onChangeText={setConfirmPassword}
                placeholder="Passwort wiederholen" placeholderTextColor={COLORS.textMuted} secureTextEntry />
            </View>

            <TouchableOpacity testID="register-submit-button" style={styles.registerBtn} onPress={handleRegister} disabled={loading}>
              {loading ? <ActivityIndicator color={COLORS.white} /> : (
                <>
                  <Ionicons name="shield-checkmark" size={20} color={COLORS.white} />
                  <Text style={styles.registerBtnText}>ZUGANG ERSTELLEN</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity testID="go-to-login" onPress={() => router.back()} style={styles.loginLink}>
            <Text style={styles.loginText}>Bereits registriert? </Text>
            <Text style={styles.loginTextBold}>Anmelden</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: SPACING.xl },
  header: { alignItems: 'center', marginBottom: 32 },
  iconCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: COLORS.primaryDark, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: COLORS.primary, marginBottom: 16,
  },
  title: { fontSize: FONTS.sizes.xl, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, letterSpacing: 2 },
  subtitle: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 4 },
  form: { gap: 2 },
  label: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold, color: COLORS.textSecondary, letterSpacing: 2, marginTop: 12, marginBottom: 4 },
  inputContainer: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 14, height: 48,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, color: COLORS.textPrimary, fontSize: FONTS.sizes.md },
  registerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COLORS.primary, borderRadius: 12, height: 52, marginTop: 24,
  },
  registerBtnText: { fontSize: FONTS.sizes.base, fontWeight: FONTS.weights.bold, color: COLORS.white, letterSpacing: 1 },
  loginLink: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
  loginText: { fontSize: FONTS.sizes.md, color: COLORS.textSecondary },
  loginTextBold: { fontSize: FONTS.sizes.md, color: COLORS.primaryLight, fontWeight: FONTS.weights.semibold },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(196,75,75,0.15)', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: COLORS.danger,
  },
  errorText: { color: COLORS.danger, fontSize: FONTS.sizes.sm, flex: 1 },
});
