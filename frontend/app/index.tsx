import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/context/AuthContext';
import { COLORS, FONTS } from '../src/utils/theme';
import { Ionicons } from '@expo/vector-icons';

export default function Index() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (user) {
        router.replace('/(tabs)/chats');
      } else {
        router.replace('/login');
      }
    }
  }, [user, loading]);

  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
        <View style={styles.iconCircle}>
          <Ionicons name="radio" size={48} color={COLORS.primaryLight} />
        </View>
        <Text style={styles.title}>444.HEIMAT-FUNK</Text>
        <Text style={styles.subtitle}>VERSCHLÜSSELTE KOMMUNIKATION</Text>
        <View style={styles.divider} />
        <Text style={styles.tagline}>Sicher. Souverän. Zuverlässig.</Text>
      </View>
      <ActivityIndicator size="large" color={COLORS.primaryLight} style={styles.loader} />
      <View style={styles.footer}>
        <Ionicons name="lock-closed" size={14} color={COLORS.textMuted} />
        <Text style={styles.footerText}>Ende-zu-Ende verschlüsselt</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.primary,
    marginBottom: 24,
  },
  title: {
    fontSize: FONTS.sizes.hero,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    letterSpacing: 3,
  },
  subtitle: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.medium,
    color: COLORS.primaryLight,
    letterSpacing: 4,
    marginTop: 8,
  },
  divider: {
    width: 60,
    height: 2,
    backgroundColor: COLORS.primary,
    marginVertical: 20,
  },
  tagline: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.regular,
  },
  loader: {
    marginTop: 40,
  },
  footer: {
    position: 'absolute',
    bottom: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textMuted,
  },
});
