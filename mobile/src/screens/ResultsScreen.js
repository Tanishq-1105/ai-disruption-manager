import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CATEGORIES } from '../config/categories.js';
import { colors, spacing, radius, typography } from '../theme/index.js';
import { Tag } from '../components/ui/index.js';
import { FilterSheet } from '../components/FilterSheet.js';
import { ResultCard } from '../components/ResultCard.js';
import { flightSearchError, withDefaultFlightDate } from '../utils/flightSearch.js';
import { formatDisplayDate } from '../utils/date.js';

function defaultFilterValues(filters) {
  const values = {};
  for (const filter of filters) values[filter.key] = filter.type === 'multi' ? [] : filter.default;
  return values;
}

export default function ResultsScreen({ route, navigation }) {
  const { category, params: routeParams } = route.params;
  const params = category === 'flights' ? withDefaultFlightDate(routeParams) : routeParams;
  const config = CATEGORIES[category];
  const sortKeys = Object.keys(config.sorts);
  const filters = config.filters || [];

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);
  const [source, setSource] = useState(null);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState(sortKeys[0]);
  const [filterValues, setFilterValues] = useState(() => defaultFilterValues(filters));
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFilterValues(defaultFilterValues(filters));

    if (category === 'flights') {
      const validationError = flightSearchError(params);
      if (validationError) {
        setError(validationError);
        setLoading(false);
        return () => {
          cancelled = true;
        };
      }
    }

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
    let filtered = q ? results.filter((item) => config.searchableText(item).toLowerCase().includes(q)) : results;
    for (const filter of filters) {
      filtered = filtered.filter((item) => filter.test(item, filterValues[filter.key]));
    }
    return [...filtered].sort(config.sorts[sortKey].compare);
  }, [results, query, sortKey, filterValues, config, filters]);

  const activeFilterCount = filters.reduce((count, filter) => {
    const value = filterValues[filter.key];
    if (filter.type === 'multi') return count + (value.length > 0 ? 1 : 0);
    return count + (value !== filter.default ? 1 : 0);
  }, 0);

  function handleFilterChange(key, type, optionValue) {
    setFilterValues((prev) => {
      if (type === 'multi') {
        const current = prev[key];
        const next = current.includes(optionValue) ? current.filter((v) => v !== optionValue) : [...current, optionValue];
        return { ...prev, [key]: next };
      }
      const filter = filters.find((f) => f.key === key);
      return { ...prev, [key]: prev[key] === optionValue ? filter.default : optionValue };
    });
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
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
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <View style={styles.controls}>
        {category === 'flights' ? (
          <View style={styles.routeSummary}>
            <View style={styles.routeCodes}>
              <Text style={styles.routeCode}>{params.origin}</Text>
              <Ionicons name="arrow-forward" size={14} color={colors.accent700} />
              <Text style={styles.routeCode}>{params.destination}</Text>
            </View>
            <Text style={styles.routeDate}>{formatDisplayDate(params.departuredate)}</Text>
          </View>
        ) : null}
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Filter by name…"
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
          />
          {filters.length > 0 ? (
            <Pressable style={styles.filterButton} onPress={() => setFilterSheetOpen(true)}>
              <Ionicons name="options-outline" size={18} color={colors.accent700} />
              {activeFilterCount > 0 ? (
                <View style={styles.filterBadge}>
                  <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
                </View>
              ) : null}
            </Pressable>
          ) : null}
        </View>

        <View style={styles.sortRow}>
          {sortKeys.map((key) => (
            <Tag
              key={key}
              label={config.sorts[key].label}
              variant={sortKey === key ? 'solid' : 'neutral'}
              size="md"
              onPress={() => setSortKey(key)}
            />
          ))}
        </View>

        <View style={styles.resultMetaRow}>
          <Text style={styles.resultMeta}>{visible.length} OPTIONS</Text>
          {source === 'mock' ? <Text style={styles.sourceMeta}>SAMPLE</Text> : null}
          {source === 'duffel' ? <Text style={styles.sourceMeta}>DUFFEL SANDBOX</Text> : null}
        </View>
      </View>

      <FlatList
        contentContainerStyle={styles.list}
        data={visible}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ResultCard item={item} category={category} config={config} navigation={navigation} />}
        ListEmptyComponent={(
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}><Ionicons name="airplane-outline" size={22} color={colors.accent800} /></View>
            <Text style={styles.emptyTitle}>No routes in this view</Text>
            <Text style={styles.emptyText}>Try another date or adjust your stops and filters.</Text>
          </View>
        )}
      />

      <FilterSheet
        visible={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        filters={filters}
        results={results}
        values={filterValues}
        onChange={handleFilterChange}
        onReset={() => setFilterValues(defaultFilterValues(filters))}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  errorText: { color: colors.danger, paddingHorizontal: 20, textAlign: 'center', fontSize: 14, lineHeight: 20 },
  controls: { padding: spacing.lg, paddingBottom: spacing.md },
  routeSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  routeCodes: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  routeCode: { ...typography.heading, fontSize: 17, color: colors.accent900 },
  routeDate: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  searchRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  searchInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 15,
    color: colors.text,
  },
  filterButton: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  filterBadgeText: { color: colors.white, fontSize: 10, fontWeight: '700' },
  sortRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md, flexWrap: 'wrap' },
  resultMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  resultMeta: { fontSize: 10, fontWeight: '800', color: colors.text, letterSpacing: 0.8 },
  sourceMeta: { fontSize: 9, fontWeight: '800', color: colors.accent700, letterSpacing: 0.6 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, flexGrow: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.xxxl },
  emptyIcon: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  emptyTitle: { ...typography.headingMedium, fontSize: 17, color: colors.text, marginBottom: spacing.xs },
  emptyText: { textAlign: 'center', color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
});
