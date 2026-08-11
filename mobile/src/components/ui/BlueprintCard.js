import { View, StyleSheet } from 'react-native';
import { colors, radius, spacing } from '../../theme/index.js';

const CORNER_SIZE = 10;

// One-off hero/summary card treatment (Track's status card, Profile's
// account/rules cards) — not for FlatList rows, four extra absolutely
// positioned views per row is wasted render cost at list scale.
export function BlueprintCard({ children, style, accent = false, padded = true }) {
  const borderColor = accent ? colors.accent : colors.divider;

  return (
    <View style={[styles.card, padded && styles.padded, { borderColor }, style]}>
      <View style={[styles.corner, styles.tl, { borderColor }]} />
      <View style={[styles.corner, styles.tr, { borderColor }]} />
      <View style={[styles.corner, styles.bl, { borderColor }]} />
      <View style={[styles.corner, styles.br, { borderColor }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  padded: {
    padding: spacing.lg,
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
  },
  tl: { top: -1, left: -1, borderTopWidth: 2, borderLeftWidth: 2 },
  tr: { top: -1, right: -1, borderTopWidth: 2, borderRightWidth: 2 },
  bl: { bottom: -1, left: -1, borderBottomWidth: 2, borderLeftWidth: 2 },
  br: { bottom: -1, right: -1, borderBottomWidth: 2, borderRightWidth: 2 },
});
