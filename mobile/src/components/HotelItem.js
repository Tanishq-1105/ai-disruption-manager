import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, spacing, typography } from '../theme/index.js';

export function HotelItem({ item }) {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>{item.name}</Text>
        <Text style={styles.price}>
          {item.pricePerNight.currency} {item.pricePerNight.amount}/night
        </Text>
      </View>
      <Text style={styles.meta}>Rating {item.rating.toFixed(1)} · {item.amenities.join(', ')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.md + 2,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    marginBottom: spacing.sm + 2,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...typography.headingMedium, fontSize: 15, color: colors.text, flexShrink: 1 },
  price: { ...typography.headingMedium, fontSize: 14, color: colors.accent700 },
  meta: { marginTop: 4, fontSize: 12, color: colors.textMuted },
});
