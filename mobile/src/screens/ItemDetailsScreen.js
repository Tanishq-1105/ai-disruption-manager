import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, radius, typography } from '../theme/index.js';
import { BlueprintCard, Eyebrow, Tag, Button } from '../components/ui/index.js';

const CATEGORY_LABEL = { flights: 'Flight', hotels: 'Hotel', cabs: 'Cab' };

export default function ItemDetailsScreen({ route, navigation }) {
  const { category, item } = route.params;

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Eyebrow>{CATEGORY_LABEL[category]} details</Eyebrow>

        {category === 'flights' ? <FlightDetails item={item} /> : null}
        {category === 'hotels' ? <HotelDetails item={item} /> : null}
        {category === 'cabs' ? <CabDetails item={item} /> : null}

        <Button
          label="Continue to booking"
          onPress={() => navigation.navigate('Booking', { category, item })}
          style={styles.bookButton}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function FlightDetails({ item }) {
  return (
    <>
      <Text style={styles.heading}>
        {item.airline} {item.flightNumber}
      </Text>
      <Text style={styles.route}>
        {item.origin} → {item.destination}
      </Text>
      <Text style={styles.price}>
        {item.price.currency} {item.price.amount ?? '—'}
      </Text>

      <BlueprintCard style={styles.card}>
        <Text style={styles.sectionTitle}>Itinerary</Text>
        {item.segments.map((seg, i) => (
          <View key={i} style={i > 0 ? styles.segmentDivider : null}>
            <View style={styles.segmentRow}>
              <Text style={styles.segmentAirline}>
                {seg.airline}
                {seg.flightNumber}
              </Text>
              <Text style={styles.segmentRoute}>
                {seg.origin} → {seg.destination}
              </Text>
            </View>
            <Text style={styles.segmentTimes}>
              {formatTime(seg.departureTime)} – {formatTime(seg.arrivalTime)} · {Math.round(seg.durationMinutes)}m
            </Text>
          </View>
        ))}
      </BlueprintCard>

      <BlueprintCard style={styles.card}>
        <Row label="Duration" value={`${Math.round(item.durationMinutes)} min`} />
        <Row label="Stops" value={item.stops === 0 ? 'Nonstop' : `${item.stops} stop${item.stops > 1 ? 's' : ''}`} />
        <Row label="Source" value={item.source === 'sabre' ? 'Live Sabre data' : 'Sample data'} />
      </BlueprintCard>
    </>
  );
}

function HotelDetails({ item }) {
  return (
    <>
      <Text style={styles.heading}>{item.name}</Text>
      <Text style={styles.price}>
        {item.pricePerNight.currency} {item.pricePerNight.amount}/night
      </Text>

      <BlueprintCard style={styles.card}>
        <Row label="Rating" value={item.rating.toFixed(1)} />
        <Row label="Check-in" value={item.checkIn || '—'} />
        <Row label="Check-out" value={item.checkOut || '—'} />
      </BlueprintCard>

      <BlueprintCard style={styles.card}>
        <Text style={styles.sectionTitle}>Amenities</Text>
        <View style={styles.tagRow}>
          {item.amenities.map((amenity) => (
            <Tag key={amenity} label={amenity} size="md" />
          ))}
        </View>
      </BlueprintCard>

      {item.mock ? <Tag variant="outline" tone="warning" label="SAMPLE DATA" style={styles.mockTag} /> : null}
    </>
  );
}

function CabDetails({ item }) {
  return (
    <>
      <Text style={styles.heading}>{item.provider}</Text>
      <Text style={styles.price}>
        {item.price.currency} {item.price.amount}
      </Text>

      <BlueprintCard style={styles.card}>
        <Row label="ETA" value={`${item.etaMinutes} min`} />
        <Row label="Seats" value={String(item.capacity)} />
      </BlueprintCard>

      {item.mock ? <Tag variant="outline" tone="warning" label="SAMPLE DATA" style={styles.mockTag} /> : null}
    </>
  );
}

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function formatTime(iso) {
  if (!iso) return '—';
  return iso.slice(11, 16);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  heading: { ...typography.heading, fontSize: 22, color: colors.text, marginTop: 4 },
  route: { fontSize: 15, color: colors.textSecondary, marginTop: spacing.xs },
  price: { ...typography.headingMedium, fontSize: 18, color: colors.accent700, marginTop: spacing.sm },
  card: { marginTop: spacing.lg },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginBottom: spacing.sm },
  segmentDivider: { borderTopWidth: 1, borderTopColor: colors.divider, marginTop: spacing.sm, paddingTop: spacing.sm },
  segmentRow: { flexDirection: 'row', justifyContent: 'space-between' },
  segmentAirline: { fontSize: 14, fontWeight: '600', color: colors.text },
  segmentRoute: { fontSize: 14, color: colors.text },
  segmentTimes: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs + 2 },
  rowLabel: { fontSize: 13, color: colors.textSecondary },
  rowValue: { fontSize: 13, color: colors.text, fontWeight: '600' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  mockTag: { marginTop: spacing.lg, alignSelf: 'flex-start' },
  bookButton: { marginTop: spacing.xl },
});
