import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, radius, spacing } from '../../theme/index.js';

export function SegmentedControl({ options, value, onChange }) {
  return (
    <View style={styles.row}>
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(opt.key)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.text, active && styles.textActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: colors.neutral100,
    borderRadius: radius.md,
    padding: 4,
  },
  segment: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.surface },
  text: { color: colors.textSecondary, fontWeight: '500' },
  textActive: { color: colors.text },
});
