import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, radius, spacing } from '../../theme/index.js';

const TONE_COLORS = {
  accent: colors.accent,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
};

// variant: 'solid' | 'neutral' | 'outline'. tone overrides the color used
// (defaults to accent) — used for track-status pills and the mock-data badge.
// Passing onPress turns it into a selectable filter chip (Results' sort chips).
export function Tag({ label, variant = 'neutral', tone, size = 'sm', onPress, style }) {
  const toneColor = tone ? TONE_COLORS[tone] : colors.accent;
  const variantStyle = getVariantStyle(variant, toneColor);
  const Wrapper = onPress ? Pressable : View;

  return (
    <Wrapper onPress={onPress} style={[styles.base, size === 'md' && styles.md, variantStyle.container, style]}>
      <Text style={[styles.text, size === 'md' && styles.textMd, variantStyle.text]}>{label}</Text>
    </Wrapper>
  );
}

function getVariantStyle(variant, toneColor) {
  switch (variant) {
    case 'solid':
      return { container: { backgroundColor: toneColor }, text: { color: colors.white } };
    case 'outline':
      return {
        container: { borderWidth: 1, borderColor: toneColor, backgroundColor: 'transparent' },
        text: { color: toneColor },
      };
    case 'neutral':
    default:
      return { container: { backgroundColor: colors.neutral100 }, text: { color: colors.neutral700 } };
  }
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  md: { paddingHorizontal: spacing.md, paddingVertical: 6 },
  text: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  textMd: { fontSize: 12 },
});
