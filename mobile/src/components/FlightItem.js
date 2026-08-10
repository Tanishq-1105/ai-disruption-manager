import { View, Text, StyleSheet } from 'react-native';

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
  card: { padding: 14, borderRadius: 10, backgroundColor: '#fff', marginBottom: 10, elevation: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontWeight: '600', fontSize: 15 },
  price: { fontWeight: '700', fontSize: 15, color: '#1a73e8' },
  route: { marginTop: 4, fontSize: 14, color: '#333' },
  meta: { marginTop: 4, fontSize: 12, color: '#777' },
});
