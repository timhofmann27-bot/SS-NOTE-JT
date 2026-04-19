import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS } from '../utils/theme';
import Storage from '../utils/Storage';

const WEB_PIN_KEY = 'web_pin_hash';

function hashPin(pin: string): string {
  let hash = 0;
  for (let i = 0; i < pin.length; i++) {
    const char = pin.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

interface BiometricLockProps {
  children: React.ReactNode;
  enabled: boolean;
}

export default function BiometricLock({ children, enabled }: BiometricLockProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(!enabled);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [isSetup, setIsSetup] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setIsAuthenticated(true);
      setIsLoading(false);
      return;
    }

    if (Platform.OS === 'web') {
      (async () => {
        const stored = await Storage.getItemAsync(WEB_PIN_KEY);
        if (stored) {
          setIsSetup(true);
        }
        setIsLoading(false);
      })();
      return;
    }

    const authenticate = async () => {
      try {
        const LocalAuthentication = await import('expo-local-authentication');
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();

        if (!hasHardware || !isEnrolled) {
          setIsAuthenticated(true);
          setIsLoading(false);
          return;
        }

        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'SS-Note entsperren',
          fallbackLabel: 'Abbrechen',
          disableDeviceFallback: true,
        });

        if (result.success) {
          setIsAuthenticated(true);
        } else {
          setError(result.error || 'Authentifizierung fehlgeschlagen');
        }
      } catch (e) {
        setError('Biometrie nicht verfügbar');
      } finally {
        setIsLoading(false);
      }
    };

    authenticate();
  }, [enabled]);

  const handleRetry = async () => {
    setError(null);
    setIsLoading(true);

    if (Platform.OS === 'web') {
      setIsLoading(false);
      return;
    }

    try {
      const LocalAuthentication = await import('expo-local-authentication');
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'SS-Note entsperren',
        fallbackLabel: 'Abbrechen',
        disableDeviceFallback: true,
      });
      if (result.success) {
        setIsAuthenticated(true);
      } else {
        setError(result.error || 'Authentifizierung fehlgeschlagen');
      }
    } catch (e) {
      setError('Biometrie nicht verfügbar');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePinSubmit = async () => {
    if (pinInput.length < 4) {
      setError('PIN muss mindestens 4 Ziffern haben');
      return;
    }

    const hashed = hashPin(pinInput);

    if (isSetup) {
      const stored = await Storage.getItemAsync(WEB_PIN_KEY);
      if (hashed === stored) {
        setIsAuthenticated(true);
        setPinInput('');
      } else {
        setError('Falsche PIN');
      }
    } else {
      await Storage.setItemAsync(WEB_PIN_KEY, hashed);
      setIsSetup(true);
      setIsAuthenticated(true);
      setPinInput('');
    }
  };

  if (!enabled || isAuthenticated) {
    return <>{children}</>;
  }

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={COLORS.primaryLight} />
        <Text style={styles.loadingText}>Entsperren...</Text>
      </View>
    );
  }

  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        <View style={styles.lockIcon}>
          <Ionicons name="lock-closed" size={48} color={COLORS.primaryLight} />
        </View>
        <Text style={styles.title}>SS-Note ist gesperrt</Text>
        <Text style={styles.subtitle}>{isSetup ? 'Gib deine PIN ein' : 'Erstelle eine PIN zum Entsperren'}</Text>

        {error && <Text style={styles.error}>{error}</Text>}

        <TextInput
          style={styles.pinInput}
          value={pinInput}
          onChangeText={setPinInput}
          placeholder="4-stellige PIN"
          placeholderTextColor={COLORS.textMuted}
          keyboardType="number-pad"
          maxLength={6}
          secureTextEntry
          onSubmitEditing={handlePinSubmit}
          autoFocus
        />

        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.retryBtn} onPress={handlePinSubmit}>
            <Ionicons name={isSetup ? 'unlock' : 'key'} size={20} color={COLORS.white} />
            <Text style={styles.retryBtnText}>{isSetup ? 'Entsperren' : 'PIN erstellen'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.lockIcon}>
        <Ionicons name="lock-closed" size={48} color={COLORS.primaryLight} />
      </View>
      <Text style={styles.title}>SS-Note ist gesperrt</Text>
      <Text style={styles.subtitle}>Entsperre die App mit deiner Biometrie</Text>

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
          <Ionicons name="finger-print" size={20} color={COLORS.white} />
          <Text style={styles.retryBtnText}>Erneut versuchen</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
  lockIcon: { width: 96, height: 96, borderRadius: 48, backgroundColor: COLORS.primaryDark, alignItems: 'center', justifyContent: 'center', marginBottom: 24, borderWidth: 2, borderColor: COLORS.primary },
  title: { fontSize: FONTS.sizes.xl, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, marginBottom: 8 },
  subtitle: { fontSize: FONTS.sizes.base, color: COLORS.textSecondary, textAlign: 'center', marginBottom: 24 },
  error: { fontSize: FONTS.sizes.sm, color: COLORS.danger, marginBottom: 16, textAlign: 'center' },
  loadingText: { fontSize: FONTS.sizes.base, color: COLORS.textSecondary, marginTop: 16 },
  buttonRow: { flexDirection: 'row', gap: 12 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  retryBtnText: { fontSize: FONTS.sizes.base, color: COLORS.white, fontWeight: FONTS.weights.bold },
  pinInput: { backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 24, height: 56, color: COLORS.textPrimary, fontSize: FONTS.sizes.xl, fontWeight: FONTS.weights.bold, textAlign: 'center', letterSpacing: 12, width: 200, marginBottom: 16 },
});
