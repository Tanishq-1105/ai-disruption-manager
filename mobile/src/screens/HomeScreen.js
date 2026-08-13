import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext.js';
import { getHistory } from '../api/endpoints.js';
import { CATEGORIES } from '../config/categories.js';
import { colors, spacing, radius, typography } from '../theme/index.js';
import { BlueprintCard, Eyebrow, ListRow } from '../components/ui/index.js';

const CATEGORY_ICONS = { flights: 'airplane-outline', hotels: 'bed-outline', cabs: 'car-outline' };
const CATEGORY_KEYS = Object.keys(CATEGORIES);

function summarizeQuery(query) {
  return Object.values(query).filter(Boolean).join(' · ') || '—';
}

export default function HomeScreen({ navigation }) {
  const { user } = useAuth();
  const [recentSearches, setRecentSearches] = useState([]);

  useFocusEffect(
    useCallback(() => {
      if (!user) {
        setRecentSearches([]);
        return;
      }
      let cancelled = false;
      getHistory()
        .then((results) => {
          if (!cancelled) setRecentSearches(results.slice(0, 3));
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [user])
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Eyebrow>TripShield</Eyebrow>
        <Text style={styles.heading}>{user ? `Hi, ${user.email.split('@')[0]}` : 'Where are you headed?'}</Text>

        <View style={styles.tileRow}>
          {CATEGORY_KEYS.map((key) => (
            <Pressable
              key={key}
              style={styles.tile}
              onPress={() => navigation.navigate('SearchHome', { category: key })}
            >
              <View style={styles.tileIcon}>
                <Ionicons name={CATEGORY_ICONS[key]} size={22} color={colors.accent700} />
              </View>
              <Text style={styles.tileLabel}>{CATEGORIES[key].label}</Text>
            </Pressable>
          ))}
        </View>

        <BlueprintCard accent style={styles.protectionCard}>
          <View style={styles.protectionHeader}>
            <Ionicons name="shield-checkmark" size={20} color={colors.accent700} />
            <Text style={styles.protectionTitle}>Book here and it's watched</Text>
          </View>
          <Text style={styles.protectionBody}>
            Every flight you book through TripShield is watched for cancellations and missed connections. If
            something breaks, the agent finds a replacement and rebooks it before you have to think about it.
          </Text>
        </BlueprintCard>

        {recentSearches.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent searches</Text>
            <BlueprintCard padded={false} style={styles.listCard}>
              {recentSearches.map((entry) => (
                <ListRow
                  key={entry.id}
                  title={CATEGORIES[entry.category]?.label || entry.category}
                  subtitle={summarizeQuery(entry.query)}
                  meta={`${entry.resultCount} result${entry.resultCount === 1 ? '' : 's'}`}
                  onPress={() => navigation.navigate('Results', { category: entry.category, params: entry.query })}
                />
              ))}
            </BlueprintCard>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>More</Text>
          <BlueprintCard padded={false} style={styles.listCard}>
            <ListRow
              icon={<Ionicons name="git-network-outline" size={18} color={colors.textSecondary} />}
              title="Trips"
              subtitle="See what TripShield is protecting"
              onPress={() => navigation.getParent()?.navigate('Trips')}
            />
            <ListRow
              icon={<Ionicons name="locate-outline" size={18} color={colors.textSecondary} />}
              title="Track a flight"
              subtitle="Check status without an account"
              onPress={() => navigation.getParent()?.navigate('Track')}
            />
          </BlueprintCard>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  heading: { ...typography.heading, fontSize: 26, color: colors.text, marginTop: 4, marginBottom: spacing.xl },
  tileRow: { flexDirection: 'row', gap: spacing.sm + 2, marginBottom: spacing.lg },
  tile: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.neutral100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  protectionCard: { marginBottom: spacing.xl },
  protectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  protectionTitle: { ...typography.headingMedium, fontSize: 15, color: colors.text },
  protectionBody: { fontSize: 13, lineHeight: 19, color: colors.textSecondary },
  section: { marginBottom: spacing.xl },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginBottom: spacing.sm },
  listCard: { paddingHorizontal: spacing.lg },
});
