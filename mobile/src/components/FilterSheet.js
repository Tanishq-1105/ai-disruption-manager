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
        <View style={styles.handle} />
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Refine results</Text>
            <Text style={styles.subtitle}>Choose what matters for this trip.</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={8}>
            <View style={styles.closeButton}><Ionicons name="close" size={18} color={colors.accent800} /></View>
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
  backdrop: { flex: 1, backgroundColor: 'rgba(6, 32, 28, 0.56)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '82%',
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderColor: colors.divider,
  },
  handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: colors.divider, alignSelf: 'center', marginTop: spacing.sm + 2 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: { ...typography.heading, fontSize: 22, color: colors.text },
  subtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  closeButton: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  group: { marginBottom: spacing.xl },
  label: { ...typography.headingMedium, fontSize: 15, color: colors.text, marginBottom: spacing.md },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  emptyText: { fontSize: 12, color: colors.textMuted },
  footer: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  footerButton: { flex: 1 },
});
