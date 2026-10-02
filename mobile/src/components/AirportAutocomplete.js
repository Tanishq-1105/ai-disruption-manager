import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { resolveAirport, searchAirports } from '../api/endpoints.js';
import { colors, radius, spacing, typography } from '../theme/index.js';

function airportLabel(airport) {
  return `${airport.city ? `${airport.city} — ` : ''}${airport.name} · ${airport.iata_code}`;
}

export function AirportAutocomplete({ value, onSelect, onClear }) {
  const [input, setInput] = useState(value ? airportLabel(value) : '');
  const [results, setResults] = useState([]);
  const [unavailable, setUnavailable] = useState([]);
  const [loading, setLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState(null);
  const [message, setMessage] = useState('');
  const selectionSequence = useRef(0);

  useEffect(() => {
    if (value) setInput(airportLabel(value));
  }, [value]);

  useEffect(() => {
    const query = input.trim();
    if (value || query.length < 2) {
      setResults([]);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setMessage('');
    const timeout = setTimeout(() => {
      searchAirports(query)
        .then((airports) => {
          if (!cancelled) {
            setResults(airports);
            setUnavailable([]);
            if (!airports.length) setMessage('No airports found');
          }
        })
        .catch(() => {
          if (!cancelled) setMessage('Airport suggestions are unavailable. Try again.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [input, value]);

  function handleChange(text) {
    selectionSequence.current += 1;
    if (value) onClear();
    setInput(text);
    setResults([]);
    setResolvingId(null);
    setMessage('');
    setUnavailable([]);
  }

  async function choose(prediction) {
    if (unavailable.includes(prediction.placeId)) return;
    const sequence = ++selectionSequence.current;
    setResolvingId(prediction.placeId);
    setMessage('');
    try {
      const result = await resolveAirport(prediction.placeId);
      if (sequence !== selectionSequence.current) return;
      if (!result.available || !result.airport?.iata_code) {
        setUnavailable((ids) => [...ids, prediction.placeId]);
        setMessage('This airport is unavailable for flight search. Choose another airport.');
        return;
      }
      setResults([]);
      setInput(airportLabel(result.airport));
      onSelect(result.airport);
    } catch {
      if (sequence === selectionSequence.current) {
        setUnavailable((ids) => [...ids, prediction.placeId]);
        setMessage('This airport could not be confirmed. Choose another airport.');
      }
    } finally {
      if (sequence === selectionSequence.current) setResolvingId(null);
    }
  }

  const showDropdown = !value && input.trim().length >= 2;

  return (
    <View style={styles.container}>
      <View style={styles.inputWrap}>
        <TextInput
          style={styles.input}
          placeholder="Search airport or city"
          placeholderTextColor={colors.textMuted}
          value={input}
          autoCapitalize="words"
          onChangeText={handleChange}
          accessibilityLabel="Search airports"
        />
        {loading ? <ActivityIndicator color={colors.accent700} /> : null}
        {value ? <Ionicons name="checkmark-circle" size={20} color={colors.accent700} /> : null}
      </View>

      {showDropdown ? (
        <View style={styles.dropdown}>
          {results.map((prediction) => {
            const isUnavailable = unavailable.includes(prediction.placeId);
            const isResolving = resolvingId === prediction.placeId;
            return (
              <Pressable
                key={prediction.placeId}
                style={styles.result}
                onPress={() => choose(prediction)}
                disabled={isUnavailable || Boolean(resolvingId)}
                accessibilityRole="button"
              >
                <Ionicons name="airplane-outline" size={18} color={colors.accent700} />
                <View style={styles.resultText}>
                  <Text style={styles.resultTitle}>{prediction.mainText}</Text>
                  {prediction.secondaryText ? <Text style={styles.resultSubtitle}>{prediction.secondaryText}</Text> : null}
                </View>
                {isResolving ? <ActivityIndicator size="small" color={colors.accent700} /> : null}
                {isUnavailable ? <Text style={styles.unavailable}>Unavailable</Text> : null}
              </Pressable>
            );
          })}
          {!loading && !results.length && message === 'No airports found' ? (
            <Text style={styles.empty}>{message}</Text>
          ) : null}
          <Text style={styles.googleAttribution}>Powered by Google</Text>
        </View>
      ) : null}
      {message && (results.length > 0 || message !== 'No airports found') ? (
        <Text style={styles.message}>{message}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { zIndex: 2 },
  inputWrap: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  input: { flex: 1, minHeight: 42, paddingVertical: spacing.sm, fontSize: 15, color: colors.text },
  dropdown: {
    marginTop: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  result: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  resultText: { flex: 1 },
  resultTitle: { ...typography.body, color: colors.text },
  resultSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  unavailable: { fontSize: 11, color: colors.danger },
  empty: { padding: spacing.md, fontSize: 13, color: colors.textSecondary },
  googleAttribution: { alignSelf: 'flex-end', padding: spacing.xs, fontSize: 10, color: colors.textMuted },
  message: { marginTop: spacing.xs, fontSize: 12, color: colors.danger },
});