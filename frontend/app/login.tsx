import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../src/context/AuthContext';
import { COLORS, FONTS, SPACING } from '../src/utils/theme';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Bitte alle Felder ausfüllen');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await login(email, password);
      router.replace('/(tabs)/chats');
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Anmeldung fehlgeschlagen');
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
              <Ionicons name="radio" size={36} color={COLORS.primaryLight} />
            </View>
            <Text style={styles.title}>444.HEIMAT-FUNK</Text>
            <Text style={styles.subtitle}>SICHERE ANMELDUNG</Text>
          </View>

          <View style={styles.form}>
            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="warning" size={16} color={COLORS.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Text style={styles.label}>KENNUNG (E-MAIL)</Text>
            <View style={styles.inputContainer}>
              <Ionicons name="mail-outline" size={18} color={COLORS.textMuted} style={styles.inputIcon} />
              <TextInput
                testID="login-email-input"
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="kennung@heimatfunk.de"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <Text style={styles.label}>PASSWORT</Text>
            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed-outline" size={18} color={COLORS.textMuted} style={styles.inputIcon} />
              <TextInput
                testID="login-password-input"
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Passwort eingeben"
                placeholderTextColor={COLORS.textMuted}
                secureTextEntry={!showPassword}
              />
              <TouchableOpacity testID="toggle-password" onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={20} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity testID="login-submit-button" style={styles.loginBtn} onPress={handleLogin} disabled={loading}>
              {loading ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <>
                  <Ionicons name="log-in-outline" size={20} color={COLORS.white} />
                  <Text style={styles.loginBtnText}>EINLOGGEN</Text>
                </>
              )}
            </TouchableOpacity>

            <View style={styles.securityBadge}>
              <Ionicons name="shield-checkmark" size={14} color={COLORS.primaryLight} />
              <Text style={styles.securityText}>Ende-zu-Ende verschlüsselt</Text>
            </View>
          </View>

          <TouchableOpacity testID="go-to-register" onPress={() => router.push('/register')} style={styles.registerLink}>
            <Text style={styles.registerText}>Noch kein Zugang? </Text>
            <Text style={styles.registerTextBold}>Registrieren</Text>
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
  header: { alignItems: 'center', marginBottom: 40 },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: COLORS.primaryDark, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: COLORS.primary, marginBottom: 16,
  },
  title: { fontSize: FONTS.sizes.xxl, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, letterSpacing: 2 },
  subtitle: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.medium, color: COLORS.primaryLight, letterSpacing: 3, marginTop: 6 },
  form: { gap: 4 },
  label: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold, color: COLORS.textSecondary, letterSpacing: 2, marginTop: 16, marginBottom: 6 },
  inputContainer: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 14, height: 52,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, color: COLORS.textPrimary, fontSize: FONTS.sizes.base },
  eyeBtn: { padding: 4 },
  loginBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COLORS.primary, borderRadius: 12, height: 52, marginTop: 24,
  },
  loginBtnText: { fontSize: FONTS.sizes.base, fontWeight: FONTS.weights.bold, color: COLORS.white, letterSpacing: 1 },
  securityBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 16 },
  securityText: { fontSize: FONTS.sizes.sm, color: COLORS.primaryLight },
  registerLink: { flexDirection: 'row', justifyContent: 'center', marginTop: 32 },
  registerText: { fontSize: FONTS.sizes.md, color: COLORS.textSecondary },
  registerTextBold: { fontSize: FONTS.sizes.md, color: COLORS.primaryLight, fontWeight: FONTS.weights.semibold },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(196,75,75,0.15)', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: COLORS.danger,
  },
  errorText: { color: COLORS.danger, fontSize: FONTS.sizes.sm, flex: 1 },
});
