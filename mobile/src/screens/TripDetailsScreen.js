import { useCallback, useState } from 'react';
import { Alert, View, Text, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  approveTripRecovery, getRecoveryStatus, getTrip, rejectTripRecovery,
  runTripRecovery, simulateTripDisruption,
} from '../api/endpoints.js';
import { FlightItem } from '../components/FlightItem.js';
import { BlueprintCard, Eyebrow, Button } from '../components/ui/index.js';
import { colors, spacing, typography } from '../theme/index.js';

export default function TripDetailsScreen({ route, navigation }) {
  const [trip, setTrip] = useState(null);
  const [recovery, setRecovery] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([getTrip(route.params.tripId), getRecoveryStatus(route.params.tripId)])
      .then(([result, recoveryResult]) => {
        if (active) {
          setTrip(result);
          setRecovery(recoveryResult);
        }
      })
      .catch(err => { if (active) setError(err.response?.data?.error ?? 'Could not load your booking.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [route.params.tripId, refresh]));

  const runRecovery = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const result = await runTripRecovery(trip.id);
      setRecovery(result);
      setRefresh(value => value + 1);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not run recovery.');
    } finally {
      setActionLoading(false);
    }
  };

  const confirmRecovery = () => {
    const approval = recovery?.approval;
    if (!approval?.binding?.fingerprint) return;
    Alert.alert(
      'Approve replacement flight?',
      `${approval.option.flightNumber} · ${approval.option.origin} → ${approval.option.destination}\n`
        + `${approval.total.currency} ${approval.total.amount}\n\n`
        + `${approval.violations.map(issue => issue.detail).join('; ')}\n\n`
        + 'This authorizes a Duffel sandbox test order. It is not a live ticket or real charge.',
      [
        { text: 'Review later', style: 'cancel' },
        { text: 'Approve & rebook', onPress: async () => {
          setActionLoading(true);
          setError(null);
          try {
            const result = await approveTripRecovery(trip.id, approval.binding.fingerprint);
            setRecovery(result);
            setRefresh(value => value + 1);
          } catch (err) {
            setError(err.response?.data?.error ?? 'Approval could not be applied. Review the current terms.');
          } finally {
            setActionLoading(false);
          }
        } },
      ],
    );
  };

  const declineRecovery = async () => {
    const fingerprint = recovery?.approval?.binding?.fingerprint;
    if (!fingerprint) return;
    setActionLoading(true);
    setError(null);
    try {
      await rejectTripRecovery(trip.id, fingerprint);
      setRefresh(value => value + 1);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not decline this recovery.');
    } finally {
      setActionLoading(false);
    }
  };

  const simulateCancellation = () => Alert.alert(
    'Simulate a cancellation?',
    'This only changes the TripShield sandbox simulation. It does not cancel the Duffel order.',
    [
      { text: 'Keep trip', style: 'cancel' },
      { text: 'Simulate', onPress: async () => {
        setActionLoading(true);
        setError(null);
        try {
          await simulateTripDisruption(trip.id);
          setRefresh(value => value + 1);
        } catch (err) {
          setError(err.response?.data?.error ?? 'Could not simulate this disruption.');
        } finally {
          setActionLoading(false);
        }
      } },
    ],
  );

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
        {recovery?.state === 'AWAITING_APPROVAL' && recovery.approval ? <BlueprintCard style={styles.section}>
          <Text style={styles.heading}>Your approval is needed</Text>
          <Text style={styles.body}>
            {recovery.approval.option.flightNumber} · {recovery.approval.option.origin} → {recovery.approval.option.destination}
          </Text>
          <Text style={styles.body}>
            {recovery.approval.option.departureTime.replace('T', ' ')} → {recovery.approval.option.arrivalTime.replace('T', ' ')}
          </Text>
          <Text style={styles.label}>Sandbox replacement fare</Text>
          <Text style={styles.body}>{recovery.approval.total.currency} {recovery.approval.total.amount}</Text>
          {recovery.approval.violations.map(issue => (
            <Text key={`${issue.rule}-${issue.detail}`} style={styles.error}>{issue.detail}</Text>
          ))}
          <Text style={styles.body}>
            This approval is only for these exact terms and expires with the quote. It authorizes a test order, not a live ticket or real payment.
          </Text>
          {Date.parse(recovery.approval.expiresAt) > Date.now() ? <>
            <Button label="Approve & rebook" loading={actionLoading} onPress={confirmRecovery} style={styles.section} />
            <Button label="Decline recovery" variant="secondary" loading={actionLoading} onPress={declineRecovery} />
          </> : <>
            <Text style={styles.error}>This offer has expired. Refresh the quote before approving.</Text>
            <Button label="Refresh quote and terms" loading={actionLoading} onPress={runRecovery} style={styles.section} />
          </>}
        </BlueprintCard> : null}
        {recovery && recovery.state !== 'AWAITING_APPROVAL' ? (
          <BlueprintCard style={styles.section}>
            <Text style={styles.label}>Recovery status</Text>
            <Text style={styles.body}>{recovery.state.replace(/_/g, ' ')}</Text>
            {recovery.detail ? <Text style={styles.body}>{recovery.detail}</Text> : null}
          </BlueprintCard>
        ) : null}
        {recovery?.events?.length ? <BlueprintCard style={styles.section}>
          <Text style={styles.heading}>Recovery history</Text>
          {recovery.events.map(event => (
            <View key={event.sequence} style={styles.event}>
              <Text style={styles.label}>{(event.action ?? event.state).replace(/_/g, ' ')}</Text>
              <Text style={styles.eventTime}>{new Date(event.at).toLocaleString()}</Text>
              {event.outcome ? <Text style={styles.body}>Outcome: {event.outcome.replace(/_/g, ' ')}</Text> : null}
              {event.detail ? <Text style={styles.body}>{event.detail}</Text> : null}
            </View>
          ))}
        </BlueprintCard> : null}
        {trip.status === 'CONFIRMED' && !recovery ? (
          <Button label="Simulate cancellation" variant="secondary" loading={actionLoading}
            onPress={simulateCancellation} style={styles.section} />
        ) : null}
        {recovery && (
          ['DISRUPTION_SIMULATED', 'ASSESSING', 'REVIEW_REQUIRED'].includes(recovery.state)
          || (recovery.state === 'AWAITING_APPROVAL' && !recovery.approval)
        ) ? (
          <Button label={recovery.state === 'REVIEW_REQUIRED' ? 'Check recovery status'
            : recovery.state === 'AWAITING_APPROVAL' ? 'Prepare approval offer' : 'Run recovery'}
            loading={actionLoading} onPress={runRecovery} style={styles.section} />
        ) : null}
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
  body: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  label: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.md, marginBottom: spacing.xs },
  section: { marginVertical: spacing.lg }, segment: { marginBottom: spacing.sm },
  event: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider, paddingVertical: spacing.sm },
  eventTime: { color: colors.textMuted, fontSize: 11, marginBottom: spacing.xs },
  error: { color: colors.danger, marginVertical: spacing.md },
});
