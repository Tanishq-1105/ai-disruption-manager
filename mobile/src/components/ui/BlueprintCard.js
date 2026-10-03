import { View, StyleSheet } from 'react-native';
import { colors, radius, spacing } from '../../theme/index.js';

export function BlueprintCard({ children, style, accent = false, padded = true }) {
  return (
    <View style={[styles.card, padded && styles.padded, accent && styles.accent, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderColor: colors.divider,
  },
  accent: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  padded: {
    padding: spacing.lg,
  },
});
