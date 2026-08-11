import { Pressable, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, radius, spacing } from '../../theme/index.js';

const VARIANTS = {
  primary: { container: { backgroundColor: colors.accent }, text: { color: colors.white } },
  secondary: { container: { backgroundColor: colors.neutral100 }, text: { color: colors.accent } },
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
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
