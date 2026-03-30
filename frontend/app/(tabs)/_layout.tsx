import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS } from '../../src/utils/theme';
import { View, Text, StyleSheet } from 'react-native';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: COLORS.surface, elevation: 0, shadowOpacity: 0, borderBottomWidth: 1, borderBottomColor: COLORS.border },
        headerTintColor: COLORS.textPrimary,
        headerTitleStyle: { fontWeight: '700', letterSpacing: 1 },
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopColor: COLORS.border,
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
          paddingTop: 4,
        },
        tabBarActiveTintColor: COLORS.primaryLight,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', letterSpacing: 1 },
      }}
    >
      <Tabs.Screen
        name="chats"
        options={{
          title: 'FUNK',
          headerTitle: () => (
            <View style={styles.headerTitle}>
              <Ionicons name="radio" size={20} color={COLORS.primaryLight} />
              <Text style={styles.headerTitleText}>444.HEIMAT-FUNK</Text>
            </View>
          ),
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" size={size} color={color} />,
          tabBarLabel: 'FUNK',
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: 'KONTAKTE',
          tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
          tabBarLabel: 'KONTAKTE',
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'EINSTELLUNGEN',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
          tabBarLabel: 'PROFIL',
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitleText: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, letterSpacing: 1 },
});
