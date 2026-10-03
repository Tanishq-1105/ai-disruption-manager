import { View, Text, Modal, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../theme/index.js';
import { Eyebrow, Button } from './ui/index.js';

// The popup a long-press on a result card opens — a shortcut past the full
// details screen straight to booking review.
export function QuickBookSheet({ visible, item, config, onClose, onViewDetails, onBook }) {
  if (!item) return null;
  const ItemComponent = config.ItemComponent;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={styles.card}>
          <View style={styles.header}>
            <View>
              <Eyebrow>SHORTCUT</Eyebrow>
              <Text style={styles.title}>Ready to go?</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeButton}>
              <Ionicons name="close" size={18} color={colors.accent800} />
            </Pressable>
          </View>
          <View style={styles.itemWrap}>
            <ItemComponent item={item} />
          </View>
          <Button label="Book this now" onPress={onBook} style={styles.bookButton} />
          <Pressable onPress={onViewDetails} hitSlop={8}>
            <Text style={styles.detailsLink}>See full details first</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6, 32, 28, 0.62)' },
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  title: { ...typography.heading, fontSize: 23, color: colors.text, marginTop: 3 },
  closeButton: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  itemWrap: { marginTop: spacing.xs, marginBottom: spacing.sm },
  bookButton: { marginTop: spacing.xs },
  detailsLink: { textAlign: 'center', color: colors.accent700, fontSize: 13, marginTop: spacing.md, fontWeight: '600' },
});
