import { Pressable, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, radius, spacing } from '../../theme/index.js';

const VARIANTS = {
  primary: { container: { backgroundColor: colors.accent800 }, text: { color: colors.white } },
  highlight: { container: { backgroundColor: colors.highlight }, text: { color: colors.highlightInk } },
  secondary: { container: { backgroundColor: colors.accentSoft }, text: { color: colors.accent800 } },
  ghost: { container: { backgroundColor: 'transparent' }, text: { color: colors.accent } },
};

export function Button({ label, onPress, variant = 'primary', disabled = false, loading = false, style }) {
  const variantStyle = VARIANTS[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        variantStyle.container,
        (disabled || loading) && styles.disabled,
        pressed && !disabled && !loading && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variantStyle.text.color} />
      ) : (
        <Text style={[styles.text, variantStyle.text]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    flexDirection: 'row',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  text: { fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
});
