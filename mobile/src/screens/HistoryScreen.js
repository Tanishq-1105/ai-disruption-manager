import { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { getHistory } from '../api/endpoints.js';
import { colors, spacing, radius, typography } from '../theme/index.js';
import { Eyebrow, Tag } from '../components/ui/index.js';

export default function HistoryScreen() {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState([]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      getHistory()
        .then((results) => {
          if (!cancelled) setEntries(results);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Eyebrow>Searches</Eyebrow>
        <Text style={styles.heading}>History</Text>
      </View>

      <FlatList
        contentContainerStyle={styles.list}
        data={entries}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={styles.emptyText}>No searches yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Tag label={item.category.toUpperCase()} size="sm" />
              <Text style={styles.meta}>{new Date(item.createdAt).toLocaleString()}</Text>
            </View>
            <Text style={styles.query}>{summarizeQuery(item.query)}</Text>
            <Text style={styles.meta}>
              {item.resultCount} result{item.resultCount === 1 ? '' : 's'}
            </Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

function summarizeQuery(query) {
  return Object.entries(query)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${value}`)
    .join(' · ') || '—';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  header: { padding: spacing.lg, paddingBottom: spacing.sm },
  heading: { ...typography.heading, fontSize: 24, color: colors.text, marginTop: 4 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  card: {
    padding: spacing.md + 2,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    marginBottom: spacing.sm + 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  query: { fontSize: 14, color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted },
  emptyText: { textAlign: 'center', color: colors.textMuted, marginTop: 40 },
});
