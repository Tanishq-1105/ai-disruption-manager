import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../theme/index.js';
import { Tag } from './ui/index.js';

export function FlightItem({ item }) {
  const connections = item.segments?.slice(0, -1).map(segment => segment.destination) ?? [];

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.carrier}>
          <View style={styles.carrierIcon}><Ionicons name="airplane" size={15} color={colors.accent800} /></View>
          <View>
            <Text style={styles.carrierLabel}>FLIGHT</Text>
            <Text style={styles.title}>{item.flightNumber || item.airline}</Text>
          </View>
        </View>
        <View style={styles.priceBlock}>
          <Text style={styles.priceCaption}>FARE</Text>
          <Text style={styles.price}>{item.price.currency} {item.price.amount ?? '—'}</Text>
        </View>
      </View>
      <View style={styles.route}>
        <View style={styles.endpoint}>
          <Text style={styles.time}>{formatTime(item.departureTime)}</Text>
          <Text style={styles.code}>{item.origin}</Text>
        </View>
        <View style={styles.journey}>
          <Text style={styles.duration}>{formatDuration(item.durationMinutes)}</Text>
          <View style={styles.routeRule}>
            <View style={styles.routeDot} />
            <View style={styles.routeDash} />
            <Ionicons name="airplane" size={14} color={colors.accent700} />
            <View style={styles.routeDash} />
            <View style={styles.routeDot} />
          </View>
          <Tag label={item.stops === 0 ? 'NONSTOP' : `${item.stops} STOP${item.stops === 1 ? '' : 'S'}`} variant={item.stops > 0 ? 'solid' : 'neutral'} size="sm" />
        </View>
        <View style={[styles.endpoint, styles.endpointEnd]}>
          <Text style={styles.time}>{formatTime(item.arrivalTime)}</Text>
          <Text style={styles.code}>{item.destination}</Text>
        </View>
      </View>
      {connections.length ? <Text style={styles.connectionPath}>VIA {connections.join('  ·  ')}</Text> : null}
    </View>
  );
}

function formatTime(iso) {
  if (!iso) return '—';
  return iso.slice(11, 16);
}

function formatDuration(minutes) {
  if (!Number.isFinite(minutes)) return '—';
  const hours = Math.floor(minutes / 60);
  const remaining = Math.round(minutes % 60);
  return hours ? `${hours}h ${remaining ? `${remaining}m` : ''}`.trim() : `${remaining}m`;
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    marginBottom: spacing.sm + 2,
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  carrier: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  carrierIcon: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  carrierLabel: { fontSize: 9, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.9 },
  title: { ...typography.headingMedium, fontSize: 14, color: colors.text, marginTop: 1 },
  priceBlock: { alignItems: 'flex-end' },
  priceCaption: { fontSize: 9, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.9 },
  price: { ...typography.headingMedium, fontSize: 15, color: colors.accent800, marginTop: 1 },
  route: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg },
  endpoint: { minWidth: 62 },
  endpointEnd: { alignItems: 'flex-end' },
  time: { ...typography.headingMedium, fontSize: 18, color: colors.text },
  code: { fontSize: 12, color: colors.textSecondary, fontWeight: '700', marginTop: 2 },
  journey: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.xs },
  duration: { fontSize: 10, fontWeight: '700', color: colors.textMuted, marginBottom: 5 },
  routeRule: { width: '100%', flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  routeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.accent700 },
  routeDash: { flex: 1, borderTopWidth: 1, borderStyle: 'dashed', borderColor: colors.divider },
  connectionPath: { alignSelf: 'center', marginTop: spacing.sm, color: colors.accent700, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
});
