import { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext.js';
import { getHistory } from '../api/endpoints.js';

export default function HistoryScreen() {
  const { logout } = useAuth();
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
        <ActivityIndicator size="large" color="#1a73e8" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.heading}>History</Text>
        <Pressable onPress={logout}>
          <Text style={styles.logout}>Log out</Text>
        </Pressable>
      </View>

      <FlatList
        contentContainerStyle={styles.list}
        data={entries}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={styles.emptyText}>No searches yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.category}>{item.category.toUpperCase()}</Text>
            <Text style={styles.query}>{summarizeQuery(item.query)}</Text>
            <Text style={styles.meta}>
              {item.resultCount} result{item.resultCount === 1 ? '' : 's'} · {new Date(item.createdAt).toLocaleString()}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

function summarizeQuery(query) {
  return Object.entries(query)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${value}`)
    .join(' · ') || '—';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f5f7' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingBottom: 8 },
  heading: { fontSize: 22, fontWeight: '700' },
  logout: { color: '#c0392b', fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingBottom: 20 },
  card: { padding: 14, borderRadius: 10, backgroundColor: '#fff', marginBottom: 10, elevation: 1 },
  category: { fontSize: 11, fontWeight: '700', color: '#1a73e8', marginBottom: 4 },
  query: { fontSize: 14, color: '#222' },
  meta: { fontSize: 12, color: '#888', marginTop: 4 },
  emptyText: { textAlign: 'center', color: '#888', marginTop: 40 },
});
