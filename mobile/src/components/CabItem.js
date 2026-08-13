import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, spacing, typography } from '../theme/index.js';

export function CabItem({ item }) {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>{item.provider}</Text>
        <Text style={styles.price}>
          {item.price.currency} {item.price.amount}
        </Text>
      </View>
      <Text style={styles.meta}>{item.etaMinutes} min away · seats {item.capacity}</Text>
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
  title: { ...typography.headingMedium, fontSize: 15, color: colors.text },
  price: { ...typography.headingMedium, fontSize: 14, color: colors.accent700 },
  meta: { marginTop: 4, fontSize: 12, color: colors.textMuted },
});
