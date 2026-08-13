import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, spacing, typography } from '../theme/index.js';

export function FlightItem({ item }) {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>{item.airline} {item.flightNumber}</Text>
        <Text style={styles.price}>
          {item.price.currency} {item.price.amount ?? '—'}
        </Text>
      </View>
      <Text style={styles.route}>{item.origin} → {item.destination}</Text>
      <Text style={styles.meta}>
        {formatTime(item.departureTime)} – {formatTime(item.arrivalTime)} ·{' '}
        {Math.round(item.durationMinutes)}m · {item.stops === 0 ? 'Nonstop' : `${item.stops} stop${item.stops > 1 ? 's' : ''}`}
      </Text>
    </View>
  );
}

function formatTime(iso) {
  if (!iso) return '—';
  return iso.slice(11, 16);
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
  price: { ...typography.headingMedium, fontSize: 15, color: colors.accent700 },
  route: { marginTop: 4, fontSize: 14, color: colors.textSecondary },
  meta: { marginTop: 4, fontSize: 12, color: colors.textMuted },
});
