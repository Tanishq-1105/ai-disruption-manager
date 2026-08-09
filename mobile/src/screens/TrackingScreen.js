import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { trackFlight } from '../api/endpoints.js';

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
    <View style={styles.screen}>
      <Text style={styles.heading}>Track a flight</Text>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          placeholder="Flight number (e.g. B6666)"
          autoCapitalize="characters"
          value={flightNumber}
          onChangeText={setFlightNumber}
          onSubmitEditing={submit}
        />
        <Pressable style={styles.button} onPress={submit}>
          <Text style={styles.buttonText}>Track</Text>
        </Pressable>
      </View>

      {loading ? <ActivityIndicator size="large" color="#1a73e8" style={styles.spacer} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {status ? (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.flightNumber}>{status.flightNumber}</Text>
            <Text style={styles.status}>{status.status}</Text>
          </View>
          <Text style={styles.route}>{status.origin} → {status.destination}</Text>
          <Text style={styles.meta}>Gate {status.gate || '—'}</Text>
          <Text style={styles.meta}>
            Departs {formatTime(status.estimatedDeparture)}
            {status.estimatedDeparture !== status.scheduledDeparture ? ` (was ${formatTime(status.scheduledDeparture)})` : ''}
          </Text>
          <Text style={styles.meta}>
            Arrives {formatTime(status.estimatedArrival)}
            {status.estimatedArrival !== status.scheduledArrival ? ` (was ${formatTime(status.scheduledArrival)})` : ''}
          </Text>
          {status.mock ? <Text style={styles.mockBadge}>Sample data — live status unavailable</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f5f7', padding: 16 },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 16 },
  searchRow: { flexDirection: 'row', gap: 10 },
  input: { flex: 1, backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  button: { backgroundColor: '#1a73e8', borderRadius: 8, paddingHorizontal: 18, justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
  spacer: { marginTop: 24 },
  error: { color: '#c0392b', marginTop: 16 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginTop: 20 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  flightNumber: { fontSize: 18, fontWeight: '700' },
  status: { fontSize: 13, fontWeight: '700', color: '#1a73e8' },
  route: { fontSize: 15, color: '#333', marginBottom: 6 },
  meta: { fontSize: 13, color: '#666', marginTop: 2 },
  mockBadge: { marginTop: 10, fontSize: 11, color: '#a66a00', backgroundColor: '#fff3cd', padding: 6, borderRadius: 6 },
});
