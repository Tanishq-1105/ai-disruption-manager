import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { CATEGORIES } from '../config/categories.js';

export default function ResultsScreen({ route }) {
  const { category, params } = route.params;
  const config = CATEGORIES[category];
  const sortKeys = Object.keys(config.sorts);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);
  const [source, setSource] = useState(null);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState(sortKeys[0]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    config
      .fetch(params)
      .then((data) => {
        if (cancelled) return;
        setResults(data.results);
        setSource(data.source);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, JSON.stringify(params)]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? results.filter((item) => config.searchableText(item).toLowerCase().includes(q))
      : results;
    return [...filtered].sort(config.sorts[sortKey].compare);
  }, [results, query, sortKey, config]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1a73e8" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.controls}>
        <TextInput
          style={styles.searchInput}
          placeholder="Filter results…"
          value={query}
          onChangeText={setQuery}
        />
        <View style={styles.sortRow}>
          {sortKeys.map((key) => (
            <Pressable
              key={key}
              onPress={() => setSortKey(key)}
              style={[styles.sortChip, sortKey === key && styles.sortChipActive]}
            >
              <Text style={[styles.sortChipText, sortKey === key && styles.sortChipTextActive]}>
                {config.sorts[key].label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.resultMeta}>
          {visible.length} result{visible.length === 1 ? '' : 's'}
          {source === 'mock' ? ' · sample data' : ''}
        </Text>
      </View>

      <FlatList
        contentContainerStyle={styles.list}
        data={visible}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <config.ItemComponent item={item} />}
        ListEmptyComponent={<Text style={styles.emptyText}>No results.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f5f7' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: '#c0392b', paddingHorizontal: 20, textAlign: 'center' },
  controls: { padding: 16, paddingBottom: 8, backgroundColor: '#f4f5f7' },
  searchInput: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginBottom: 10 },
  sortRow: { flexDirection: 'row', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  sortChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#e6e8ec' },
  sortChipActive: { backgroundColor: '#1a73e8' },
  sortChipText: { fontSize: 12, color: '#555', fontWeight: '500' },
  sortChipTextActive: { color: '#fff' },
  resultMeta: { fontSize: 12, color: '#888' },
  list: { paddingHorizontal: 16, paddingBottom: 20 },
  emptyText: { textAlign: 'center', color: '#888', marginTop: 40 },
});
