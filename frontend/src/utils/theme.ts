// 444.HEIMAT-FUNK Theme
export const COLORS = {
  // Core
  background: '#080C0A',
  surface: '#111916',
  surfaceLight: '#1A2420',
  surfaceHighlight: '#223029',
  
  // Accent
  primary: '#2D5A3D',
  primaryLight: '#3A7A52',
  primaryDark: '#1E3D2A',
  
  // Text
  textPrimary: '#E8EDE9',
  textSecondary: '#8A9B8F',
  textMuted: '#5A6B5F',
  
  // Status
  online: '#4ADE80',
  offline: '#6B7280',
  away: '#FBBF24',
  
  // Security Levels
  unclassified: '#6B8F71',
  restricted: '#D4A843',
  confidential: '#E67E22',
  secret: '#C44B4B',
  
  // Message
  sentBubble: '#1E3D2A',
  receivedBubble: '#1A2420',
  emergency: '#7F1D1D',
  
  // Misc
  border: '#1F2D25',
  divider: '#162019',
  inputBg: '#111916',
  danger: '#C44B4B',
  success: '#4ADE80',
  white: '#FFFFFF',
};

export const FONTS = {
  sizes: {
    xs: 10,
    sm: 12,
    md: 14,
    base: 16,
    lg: 18,
    xl: 20,
    xxl: 24,
    hero: 32,
  },
  weights: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
};

export const SECURITY_LEVELS = [
  { key: 'UNCLASSIFIED', label: 'OFFEN', color: COLORS.unclassified },
  { key: 'RESTRICTED', label: 'VS-NfD', color: COLORS.restricted },
  { key: 'CONFIDENTIAL', label: 'VS-VERTRAULICH', color: COLORS.confidential },
  { key: 'SECRET', label: 'GEHEIM', color: COLORS.secret },
];

export const ROLES = {
  commander: { label: 'Kommandant', icon: 'star', color: COLORS.restricted },
  officer: { label: 'Offizier', icon: 'shield', color: COLORS.primaryLight },
  soldier: { label: 'Soldat', icon: 'person', color: COLORS.textSecondary },
};
