import { useCallback, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { getTrip } from '../api/endpoints.js';
import { FlightItem } from '../components/FlightItem.js';
import { BlueprintCard, Eyebrow, Button } from '../components/ui/index.js';
import { colors, spacing, typography } from '../theme/index.js';

export default function TripDetailsScreen({ route, navigation }) {
  const [trip, setTrip] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getTrip(route.params.tripId).then(result => { if (active) setTrip(result); })
      .catch(err => { if (active) setError(err.response?.data?.error ?? 'Could not load your booking.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [route.params.tripId, refresh]));

  return <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
    <ScrollView contentContainerStyle={styles.content}>
      <Eyebrow>Duffel sandbox</Eyebrow>
      {loading ? <ActivityIndicator color={colors.accent700} style={styles.section} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {trip ? <>
        <Text style={styles.heading}>{trip.status === 'CONFIRMED' ? 'Booking confirmed' : trip.status === 'CANCELLED' ? 'Booking cancelled' : 'Booking status'}</Text>
        <Text style={styles.reference}>{trip.bookingReference ? `Reference: ${trip.bookingReference}` : 'Confirmation pending'}</Text>
        <FlightItem item={{ ...trip.flight, price: trip.total }} />
        <BlueprintCard style={styles.section}>
          <Text style={styles.label}>Passenger</Text><Text style={styles.body}>{trip.passengerName ?? '—'}</Text>
          <Text style={styles.label}>Itinerary · airport local times</Text>
          {trip.flight.segments.map((segment, index) => <View key={index} style={styles.segment}>
            <Text style={styles.body}>{segment.airline}{segment.flightNumber} · {segment.origin} → {segment.destination}</Text>
            <Text style={styles.body}>{segment.departureTime.replace('T', ' ')} → {segment.arrivalTime.replace('T', ' ')}</Text>
          </View>)}
          <Text style={styles.label}>Total</Text><Text style={styles.body}>{trip.total.currency} {trip.total.amount}</Text>
        </BlueprintCard>
        <Text style={styles.body}>{trip.message ?? 'Saved to your account. This test reservation creates no usable airline ticket or real charge.'}</Text>
        {trip.orderId ? <Button label="Track this trip" variant="secondary" style={styles.section}
          onPress={() => navigation.getParent()?.navigate('Track', { screen: 'FlightTracking', params: { tripId: trip.id } })} /> : null}
        {['BOOKING', 'PENDING', 'REVIEW_REQUIRED'].includes(trip.status)
          ? <Button label="Check booking status" loading={loading} onPress={() => setRefresh(value => value + 1)} style={styles.section} /> : null}
      </> : null}
      {error ? <Button label="Retry" loading={loading} onPress={() => setRefresh(value => value + 1)} style={styles.section} /> : null}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg }, content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  heading: { ...typography.heading, fontSize: 23, color: colors.text, marginVertical: spacing.md },
  reference: { ...typography.headingMedium, fontSize: 18, color: colors.accent700, marginBottom: spacing.lg },
  label: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.md, marginBottom: spacing.xs },
  body: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  section: { marginVertical: spacing.lg }, segment: { marginBottom: spacing.sm },
  error: { color: colors.danger, marginVertical: spacing.md },
});
