import { useCallback, useRef, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { getTrips, trackTrip } from '../api/endpoints.js';
import { FlightItem } from '../components/FlightItem.js';
import { colors, spacing, typography } from '../theme/index.js';
import { BlueprintCard, Tag, Button, Eyebrow } from '../components/ui/index.js';

export default function TrackingScreen({ navigation, route }) {
  const [trips, setTrips] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [listing, setListing] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const request = useRef(0);

  useFocusEffect(useCallback(() => {
    let active = true;
    setListing(true);
    setError(null);
    getTrips().then(results => {
      if (!active) return;
      const booked = results.filter(trip => trip.orderId);
      setTrips(booked);
      setSelected(previous => booked.find(trip => trip.id === route.params?.tripId)?.id
        ?? booked.find(trip => trip.id === previous)?.id ?? booked[0]?.id ?? null);
    }).catch(err => { if (active) setError(err.response?.data?.error ?? 'Could not load your saved bookings.'); })
      .finally(() => { if (active) setListing(false); });
    return () => { active = false; };
  }, [route.params?.tripId, refresh]));

  const check = useCallback(async () => {
    if (!selected) return;
    const current = ++request.current;
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const result = await trackTrip(selected);
      if (current === request.current) setStatus(result);
    } catch (err) {
      if (current === request.current) setError(err.response?.data?.error ?? 'Could not check Duffel. Please try again.');
    } finally { if (current === request.current) setLoading(false); }
  }, [selected]);

  useFocusEffect(useCallback(() => { check(); return () => { request.current += 1; }; }, [check]));

  return <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={styles.content}>
      <Eyebrow>Track</Eyebrow>
      <Text style={styles.heading}>Track your booking</Text>
      <Text style={styles.body}>Check a saved Duffel order and airline-reported schedule changes. This sandbox does not report live boarding or landed status.</Text>
      {listing ? <ActivityIndicator style={styles.section} color={colors.accent700} /> : null}
      <View style={styles.choices}>{trips.map(trip => <Tag key={trip.id}
        label={`${trip.flight.flightNumber} · ${trip.flight.departureTime.slice(0, 10)} · ${trip.bookingReference ?? 'Pending'}`}
        variant={selected === trip.id ? 'solid' : 'neutral'} size="md" onPress={() => setSelected(trip.id)} />)}</View>
      {!listing && trips.length === 0 ? <BlueprintCard style={styles.section}>
        <Text style={styles.subheading}>No saved bookings to track</Text>
        <Text style={styles.body}>Book a sandbox flight first, then check its order and schedule here.</Text>
        <Button label="Open protected trips" onPress={() => navigation.getParent()?.navigate('Trips')} />
      </BlueprintCard> : null}
      {selected ? <Button label="Refresh from Duffel" loading={loading} onPress={check} style={styles.section} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {error && !selected ? <Button label="Retry" onPress={() => setRefresh(value => value + 1)} /> : null}
      {status ? <>
        <BlueprintCard accent style={styles.section}>
          <View style={styles.row}><Text style={styles.subheading}>Booking status</Text><Tag label={status.bookingStatus} /></View>
          <Text style={styles.body}>Reference: {status.bookingReference ?? 'Pending'}</Text>
          <Text style={styles.body}>Checked {new Date(status.checkedAt).toLocaleTimeString()} · Duffel sandbox API</Text>
          {status.syncedAt ? <Text style={styles.body}>Airline sync: {new Date(status.syncedAt).toLocaleString()}</Text> : null}
        </BlueprintCard>
        <FlightItem item={status.flight} />
        <Text style={styles.subheading}>Airline-reported changes</Text>
        {status.changes.length === 0 ? <Text style={styles.body}>No changes reported for this booking. This does not establish that the flight is on time.</Text>
          : status.changes.map(change => <BlueprintCard key={change.id} style={styles.section}>
            <Tag label={change.actionTaken ? `RESOLVED: ${change.actionTaken.toUpperCase()}` : 'NEEDS REVIEW'} />
            <Text style={styles.body}>{new Date(change.createdAt).toLocaleString()}</Text>
            <Text style={styles.label}>Previously</Text>
            {change.previous.map((segment, index) => <Text key={index} style={styles.body}>{segment.flightNumber} · {segment.origin} → {segment.destination} · {segment.departureTime?.replace('T', ' ')}</Text>)}
            <Text style={styles.label}>Updated schedule</Text>
            {change.updated.length ? change.updated.map((segment, index) => <Text key={index} style={styles.body}>{segment.flightNumber} · {segment.origin} → {segment.destination} · {segment.departureTime?.replace('T', ' ')}</Text>)
              : <Text style={styles.body}>No replacement schedule supplied.</Text>}
          </BlueprintCard>)}
      </> : null}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg }, content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  heading: { ...typography.heading, fontSize: 24, color: colors.text, marginTop: 4, marginBottom: spacing.lg },
  subheading: { ...typography.headingMedium, fontSize: 16, color: colors.text, marginBottom: spacing.sm },
  body: { fontSize: 13, lineHeight: 20, color: colors.textSecondary, marginBottom: spacing.sm },
  label: { fontSize: 13, fontWeight: '700', color: colors.text, marginVertical: spacing.sm },
  section: { marginVertical: spacing.md }, choices: { gap: spacing.sm, alignItems: 'flex-start', marginTop: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  error: { color: colors.danger, marginVertical: spacing.lg },
});
