export const colors = {
  bg: '#F3F6F3',
  bgTint: '#E9F0EC',
  surface: '#FFFFFF',
  text: '#13211D',
  textSecondary: '#53635D',
  textMuted: '#84928B',
  neutral100: '#E9EFEC',
  neutral700: '#34453E',
  divider: '#D7E1DB',
  accent: '#0F6B62',
  accent700: '#0C554E',
  accent800: '#093F3A',
  accent900: '#062A27',
  accentSoft: '#D8ECE5',
  highlight: '#D8F06A',
  highlightInk: '#26320C',
  warm: '#EBA779',
  success: '#1E8E5A',
  warning: '#B7791F',
  danger: '#C0392B',
  white: '#FFFFFF',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };

export const radius = { sm: 4, md: 8, lg: 8, pill: 999 };

// Space Grotesk for headings/numbers only; body text stays on the RN system
// default (SF on iOS / Roboto on Android) — see theme/fonts.js.
export const typography = {
  heading: { fontFamily: 'SpaceGrotesk_700Bold', letterSpacing: 0 },
  headingMedium: { fontFamily: 'SpaceGrotesk_500Medium', letterSpacing: 0 },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
};

export const theme = { colors, spacing, radius, typography };
