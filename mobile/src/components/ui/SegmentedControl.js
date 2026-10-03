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
    backgroundColor: colors.accent900,
    borderRadius: radius.md,
    padding: 5,
    gap: 3,
  },
  segment: { flex: 1, minHeight: 38, paddingVertical: spacing.sm, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: colors.highlight },
  text: { color: '#C5D5CE', fontWeight: '600', fontSize: 13 },
  textActive: { color: colors.highlightInk },
});
