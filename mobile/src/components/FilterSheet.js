import { View, Text, Modal, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../theme/index.js';
import { Tag, Button } from './ui/index.js';

// Renders one chip row per filter in a category's `filters` config (see
// config/categories.js) — 'choice' filters are single-select, 'multi' toggle
// membership in an array. Values live in ResultsScreen state; this is just the UI.
export function FilterSheet({ visible, onClose, filters, results, values, onChange, onReset }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>Filter</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {filters.map((filter) => {
            const options = filter.type === 'multi' ? filter.getOptions(results) : filter.options;
            const value = values[filter.key];

            return (
              <View key={filter.key} style={styles.group}>
                <Text style={styles.label}>{filter.label}</Text>
                <View style={styles.chipRow}>
                  {options.map((opt) => {
                    const active = filter.type === 'multi' ? value.includes(opt.value) : value === opt.value;
                    return (
                      <Tag
                        key={opt.value}
                        label={opt.label}
                        variant={active ? 'solid' : 'neutral'}
                        size="md"
                        onPress={() => onChange(filter.key, filter.type, opt.value)}
                      />
                    );
                  })}
                  {options.length === 0 ? <Text style={styles.emptyText}>No options in this result set.</Text> : null}
                </View>
              </View>
            );
          })}
        </ScrollView>

        <View style={styles.footer}>
          <Button label="Reset" variant="secondary" onPress={onReset} style={styles.footerButton} />
          <Button label="Done" onPress={onClose} style={styles.footerButton} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(6, 42, 39, 0.4)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '75%',
    paddingBottom: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  title: { ...typography.heading, fontSize: 17, color: colors.text },
  content: { padding: spacing.lg },
  group: { marginBottom: spacing.lg },
  label: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  emptyText: { fontSize: 12, color: colors.textMuted },
  footer: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  footerButton: { flex: 1 },
});
