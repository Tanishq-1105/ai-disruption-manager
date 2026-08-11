import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { trackFlight } from '../api/endpoints.js';
import { colors, spacing, radius, typography } from '../theme/index.js';
import { BlueprintCard, Tag, Button, Eyebrow } from '../components/ui/index.js';

const STATUS_TONE = {
  ON_TIME: 'success',
  DELAYED: 'warning',
  BOARDING: 'accent',
  DEPARTED: 'accent',
  LANDED: 'success',
};

export default function TrackingScreen() {
  const [flightNumber, setFlightNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);

  async function submit() {
    if (!flightNumber.trim()) return;
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      setStatus(await trackFlight(flightNumber.trim()));
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <View style={styles.content}>
        <Eyebrow>Track a flight</Eyebrow>
        <Text style={styles.heading}>Where's your flight?</Text>

        <View style={styles.searchRow}>
          <TextInput
            style={styles.input}
            placeholder="Flight number (e.g. B6666)"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
            value={flightNumber}
            onChangeText={setFlightNumber}
            onSubmitEditing={submit}
          />
          <Button label="Track" onPress={submit} loading={loading} />
        </View>

        {loading ? <ActivityIndicator size="large" color={colors.accent} style={styles.spacer} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {status ? (
          <BlueprintCard accent style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.flightNumber}>{status.flightNumber}</Text>
              <Tag variant="solid" tone={STATUS_TONE[status.status] || 'accent'} label={status.status} size="md" />
            </View>
            <Text style={styles.route}>
              {status.origin} → {status.destination}
            </Text>
            <Text style={styles.meta}>Gate {status.gate || '—'}</Text>
            <Text style={styles.meta}>
              Departs {formatTime(status.estimatedDeparture)}
              {status.estimatedDeparture !== status.scheduledDeparture
                ? ` (was ${formatTime(status.scheduledDeparture)})`
                : ''}
            </Text>
            <Text style={styles.meta}>
              Arrives {formatTime(status.estimatedArrival)}
              {status.estimatedArrival !== status.scheduledArrival
                ? ` (was ${formatTime(status.scheduledArrival)})`
                : ''}
            </Text>
            {status.mock ? (
              <Tag
                variant="outline"
                tone="warning"
                label="SAMPLE DATA — LIVE STATUS UNAVAILABLE"
                style={styles.mockTag}
              />
            ) : null}
          </BlueprintCard>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, padding: spacing.lg },
  heading: { ...typography.heading, fontSize: 24, color: colors.text, marginTop: 4, marginBottom: spacing.lg },
  searchRow: { flexDirection: 'row', gap: spacing.sm + 2 },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 15,
    color: colors.text,
  },
  spacer: { marginTop: spacing.xl },
  error: { color: colors.danger, marginTop: spacing.lg },
  card: { marginTop: spacing.xl },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  flightNumber: { ...typography.heading, fontSize: 19, color: colors.text },
  route: { fontSize: 15, color: colors.text, marginBottom: spacing.sm },
  meta: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  mockTag: { marginTop: spacing.md },
});
