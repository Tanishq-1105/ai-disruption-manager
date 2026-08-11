export const colors = {
  bg: '#F5F8F7',
  surface: '#FFFFFF',
  text: '#101816',
  textSecondary: '#5C6A68',
  textMuted: '#8A9694',
  neutral100: '#EEF1F1',
  neutral700: '#34403E',
  divider: '#DCE3E1',
  accent: '#0F6B62',
  accent700: '#0C554E',
  accent800: '#093F3A',
  accent900: '#062A27',
  success: '#1E8E5A',
  warning: '#B7791F',
  danger: '#C0392B',
  white: '#FFFFFF',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };

export const radius = { sm: 6, md: 10, lg: 14, pill: 999 };

// Space Grotesk for headings/numbers only; body text stays on the RN system
// default (SF on iOS / Roboto on Android) — see theme/fonts.js.
export const typography = {
  heading: { fontFamily: 'SpaceGrotesk_700Bold', letterSpacing: -0.3 },
  headingMedium: { fontFamily: 'SpaceGrotesk_500Medium' },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
};

export const theme = { colors, spacing, radius, typography };
