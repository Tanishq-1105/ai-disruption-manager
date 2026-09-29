import { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getTrips } from '../api/endpoints.js';
import { colors, spacing, radius, typography } from '../theme/index.js';
import { Eyebrow, Button, Tag } from '../components/ui/index.js';

export default function TripsScreen({ navigation }) {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refresh, setRefresh] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getTrips().then(results => { if (active) setTrips(results); })
      .catch(err => { if (active) setError(err.response?.data?.error ?? 'Could not load your trips.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]));

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Eyebrow>Trips</Eyebrow>
        <Text style={styles.heading}>Protected trips</Text>
        <Text style={styles.subtitle}>Your saved sandbox flights. Live monitoring is not enabled yet.</Text>
      </View>
      {error ? <View style={styles.header}><Text style={styles.error}>{error}</Text><Button label="Retry" onPress={() => setRefresh(value => value + 1)} /></View> : null}
      {loading && trips.length === 0 ? <ActivityIndicator style={styles.loader} size="large" color={colors.accent700} /> : (
        <FlatList data={trips} keyExtractor={trip => trip.id} contentContainerStyle={styles.list}
          refreshing={loading} onRefresh={() => setRefresh(value => value + 1)}
          renderItem={({ item: trip }) => (
            <Pressable style={styles.card} onPress={() => navigation.navigate('TripDetails', { tripId: trip.id })}>
              <View style={styles.row}>
                <Ionicons name="airplane-outline" size={22} color={colors.accent700} />
                <Tag label={trip.status === 'CONFIRMED' ? 'CONFIRMED' : trip.status === 'CANCELLED' ? 'CANCELLED' : 'CHECK STATUS'} />
              </View>
              <Text style={styles.route}>{trip.flight.origin} → {trip.flight.destination}</Text>
              <Text style={styles.subtitle}>{trip.flight.flightNumber} · {trip.flight.departureTime.slice(0, 10)} · {trip.flight.departureTime.slice(11, 16)}</Text>
              <Text style={styles.reference}>{trip.bookingReference ? `Reference ${trip.bookingReference}` : 'Awaiting booking confirmation'}</Text>
              <View style={styles.row}><Text style={styles.subtitle}>Duffel sandbox</Text><Text style={styles.reference}>{trip.total.currency} {trip.total.amount}</Text></View>
            </Pressable>
          )}
          ListEmptyComponent={!error ? <View style={styles.empty}>
            <Ionicons name="shield-checkmark-outline" size={42} color={colors.accent700} />
            <Text style={styles.emptyTitle}>No protected trips yet</Text>
            <Text style={styles.subtitle}>Book a sandbox flight and it will appear here automatically.</Text>
            <Button label="Find a flight" onPress={() => navigation.getParent()?.navigate('HomeTab', { screen: 'SearchHome', params: { category: 'flights' } })} style={styles.search} />
          </View> : null} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { padding: spacing.lg, paddingBottom: spacing.sm },
  heading: { ...typography.heading, fontSize: 24, color: colors.text, marginTop: 4, marginBottom: spacing.sm },
  subtitle: { fontSize: 13, lineHeight: 20, color: colors.textSecondary },
  loader: { marginTop: spacing.xxl }, list: { padding: spacing.lg, flexGrow: 1 },
  card: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.surface, marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  route: { ...typography.headingMedium, fontSize: 22, color: colors.text, marginTop: spacing.md, marginBottom: spacing.xs },
  reference: { fontSize: 14, fontWeight: '600', color: colors.accent700, marginVertical: spacing.sm },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  emptyTitle: { ...typography.headingMedium, fontSize: 18, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  search: { marginTop: spacing.lg }, error: { color: colors.danger, marginBottom: spacing.sm },
});
