import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext.js';
import { getHistory } from '../api/endpoints.js';
import { CATEGORIES } from '../config/categories.js';
import { colors, spacing, radius, typography } from '../theme/index.js';
import { Eyebrow, ListRow, Button } from '../components/ui/index.js';

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
        <View style={styles.topBar}>
          <View style={styles.brandLockup}>
            <View style={styles.brandMark}><Ionicons name="airplane" size={18} color={colors.highlight} /></View>
            <View>
              <Text style={styles.brandName}>TRIPSHIELD</Text>
              <Text style={styles.brandCaption}>TRAVEL, WITH BACKUP</Text>
            </View>
          </View>
          <Pressable style={styles.profileButton} onPress={() => navigation.getParent()?.navigate('You')}>
            <Ionicons name={user ? 'person' : 'person-outline'} size={18} color={colors.accent800} />
          </Pressable>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroHeader}>
            <Eyebrow style={styles.heroEyebrow}>YOUR NEXT DEPARTURE</Eyebrow>
            <View style={styles.departureMark}><Text style={styles.departureMarkText}>01</Text></View>
          </View>
          <Text style={styles.heading}>{user ? `Ready for takeoff, ${user.email.split('@')[0]}?` : 'Where to\nnext?'}</Text>
          <Text style={styles.heroCopy}>Find a route worth waking up for.</Text>
          <View style={styles.routeSketch}>
            <View style={styles.routeNode}><Ionicons name="radio-button-on" size={16} color={colors.highlight} /></View>
            <View style={styles.routeDash} />
            <Ionicons name="airplane" size={17} color={colors.highlight} style={styles.routePlane} />
            <View style={styles.routeDash} />
            <View style={styles.routeNode}><Ionicons name="location" size={18} color={colors.highlight} /></View>
            <Text style={styles.routeSketchCaption}>OPEN SKY · OPEN PLANS</Text>
          </View>
          <Button
            label="Search flights"
            variant="highlight"
            onPress={() => navigation.navigate('SearchHome', { category: 'flights' })}
            style={styles.heroButton}
          />
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Make it a trip</Text>
          <Text style={styles.sectionMeta}>01 / 03</Text>
        </View>
        <View style={styles.tileRow}>
          {CATEGORY_KEYS.map((key) => (
            <Pressable
              key={key}
              style={styles.tile}
              onPress={() => navigation.navigate('SearchHome', { category: key })}
            >
              <Ionicons name={CATEGORY_ICONS[key]} size={20} color={key === 'flights' ? colors.accent700 : colors.textSecondary} />
              <Text style={styles.tileLabel}>{CATEGORIES[key].label}</Text>
              <Ionicons name="arrow-forward" size={13} color={colors.textMuted} />
            </Pressable>
          ))}
        </View>

        <View style={styles.protectionRow}>
          <View style={styles.protectionIcon}><Ionicons name="shield-checkmark" size={19} color={colors.accent800} /></View>
          <View style={styles.protectionCopy}>
            <Text style={styles.protectionTitle}>Your trips, kept together</Text>
            <Text style={styles.protectionBody}>Confirmed sandbox flights are saved to Protected Trips.</Text>
          </View>
          <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
        </View>

        {recentSearches.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recently explored</Text>
              <Ionicons name="time-outline" size={16} color={colors.textMuted} />
            </View>
            <View style={styles.listCard}>
              {recentSearches.map((entry, index) => (
                <View key={entry.id} style={index < recentSearches.length - 1 && styles.rowDivider}>
                  <ListRow
                    icon={<Ionicons name={CATEGORY_ICONS[entry.category] || 'search-outline'} size={18} color={colors.accent700} />}
                    title={CATEGORIES[entry.category]?.label || entry.category}
                    subtitle={summarizeQuery(entry.query)}
                    meta={`${entry.resultCount} results`}
                    onPress={() => navigation.navigate('Results', { category: entry.category, params: entry.query })}
                  />
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <Pressable style={styles.savedLink} onPress={() => navigation.getParent()?.navigate('Trips')}>
          <View style={styles.savedLinkIcon}><Ionicons name="bookmark-outline" size={17} color={colors.accent700} /></View>
          <Text style={styles.savedLinkText}>Open Protected Trips</Text>
          <Ionicons name="arrow-forward" size={16} color={colors.accent700} />
        </Pressable>

        <View style={styles.footnote}>
          <Ionicons name="sparkles-outline" size={14} color={colors.warm} />
          <Text style={styles.footnoteText}>SANDBOX BOOKINGS · NO LIVE TICKETS</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: spacing.xxxl },
  topBar: { minHeight: 66, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandLockup: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  brandMark: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: colors.accent900, alignItems: 'center', justifyContent: 'center' },
  brandName: { fontSize: 12, fontWeight: '800', color: colors.accent900, letterSpacing: 1.5 },
  brandCaption: { fontSize: 9, color: colors.textMuted, fontWeight: '700', marginTop: 2, letterSpacing: 0.7 },
  profileButton: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  hero: { backgroundColor: colors.accent900, paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xl, marginBottom: spacing.xl },
  heroHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroEyebrow: { color: colors.highlight },
  departureMark: { width: 30, height: 30, borderRadius: radius.sm, borderWidth: 1, borderColor: '#42645B', alignItems: 'center', justifyContent: 'center' },
  departureMarkText: { color: '#B8CFC4', fontSize: 10, fontWeight: '700' },
  heading: { ...typography.heading, fontSize: 34, lineHeight: 40, color: colors.white, marginTop: spacing.lg, maxWidth: 300 },
  heroCopy: { color: '#B9CCC5', fontSize: 14, marginTop: spacing.sm },
  routeSketch: { height: 54, flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.lg },
  routeNode: { width: 28, height: 28, borderRadius: radius.sm, backgroundColor: '#174B42', alignItems: 'center', justifyContent: 'center' },
  routeDash: { flex: 1, height: 1, borderStyle: 'dashed', borderTopWidth: 1, borderColor: '#6C8D78', marginHorizontal: spacing.xs },
  routePlane: { transform: [{ rotate: '35deg' }] },
  routeSketchCaption: { position: 'absolute', right: 0, bottom: -2, color: '#8FA99B', fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  heroButton: { alignSelf: 'flex-start', minWidth: 172 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, marginBottom: spacing.sm + 2 },
  sectionTitle: { ...typography.headingMedium, fontSize: 17, color: colors.text },
  sectionMeta: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  tileRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.xl },
  tile: {
    flex: 1,
    minHeight: 74,
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  tileLabel: { fontSize: 12, fontWeight: '700', color: colors.text },
  protectionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.divider, marginBottom: spacing.xl },
  protectionIcon: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  protectionCopy: { flex: 1 },
  protectionTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  protectionBody: { fontSize: 11, lineHeight: 16, color: colors.textSecondary, marginTop: 3 },
  section: { marginBottom: spacing.xl },
  listCard: { marginHorizontal: spacing.lg },
  rowDivider: { borderBottomWidth: 1, borderColor: colors.divider },
  savedLink: { marginHorizontal: spacing.lg, minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, backgroundColor: colors.accentSoft, paddingHorizontal: spacing.md },
  savedLinkIcon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  savedLinkText: { flex: 1, color: colors.accent900, fontWeight: '700', fontSize: 13 },
  footnote: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xl },
  footnoteText: { color: colors.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
});
