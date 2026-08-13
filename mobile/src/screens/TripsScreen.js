import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '../theme/index.js';
import { Eyebrow } from '../components/ui/index.js';

// The trip dependency graph (Stage 0+ protection view) needs a booking flow
// and trip-graph API this build doesn't have yet — see CLAUDE.md's Build
// notes. Until then this is an honest empty state, not a faked graph.
export default function TripsScreen() {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <Eyebrow>Trips</Eyebrow>
        <Text style={styles.heading}>Trips</Text>
      </View>

      <View style={styles.empty}>
        <View style={styles.iconCircle}>
          <Ionicons name="git-network-outline" size={28} color={colors.accent700} />
        </View>
        <Text style={styles.emptyTitle}>No protected trips yet</Text>
        <Text style={styles.emptyBody}>
          Once booking is live, every trip you book here shows up as a dependency graph — flight, hotel, cab,
          commitments — and TripShield watches it for disruptions automatically.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { padding: spacing.lg, paddingBottom: spacing.sm },
  heading: { ...typography.heading, fontSize: 24, color: colors.text, marginTop: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxl },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.neutral100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: { ...typography.headingMedium, fontSize: 17, color: colors.text, marginBottom: spacing.sm },
  emptyBody: { fontSize: 13.5, lineHeight: 20, color: colors.textSecondary, textAlign: 'center' },
});
