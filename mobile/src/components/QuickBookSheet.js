import { View, Text, Modal, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../theme/index.js';
import { Eyebrow, Button } from './ui/index.js';

// The popup a long-press on a result card opens — a shortcut past the full
// details screen straight to the (demo) booking flow.
export function QuickBookSheet({ visible, item, config, onClose, onViewDetails, onBook }) {
  if (!item) return null;
  const ItemComponent = config.ItemComponent;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={styles.card}>
          <Eyebrow>Quick book</Eyebrow>
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
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6, 42, 39, 0.45)' },
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  itemWrap: { marginTop: spacing.sm, marginBottom: spacing.sm },
  bookButton: { marginTop: spacing.xs },
  detailsLink: { textAlign: 'center', color: colors.accent700, fontSize: 13, marginTop: spacing.md, fontWeight: '600' },
});
