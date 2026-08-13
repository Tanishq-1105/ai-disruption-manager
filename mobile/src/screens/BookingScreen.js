import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CATEGORIES } from '../config/categories.js';
import { colors, spacing, radius, typography } from '../theme/index.js';
import { BlueprintCard, Eyebrow, Button } from '../components/ui/index.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

// Screens 05–07 (review/payment/confirmed) need real booking routes that
// don't exist yet — see CLAUDE.md's Build notes. This is a stub that's
// honest about being one: it confirms nothing for real, but gives the tap
// → details → book flow somewhere to land.
export default function BookingScreen({ route, navigation }) {
  const { category, item } = route.params;
  const config = CATEGORIES[category];
  const ItemComponent = config.ItemComponent;
  const [confirmed, setConfirmed] = useState(false);
  const [code] = useState(randomCode);

  if (confirmed) {
    return (
      <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
        <View style={styles.confirmedWrap}>
          <View style={styles.iconCircle}>
            <Ionicons name="checkmark" size={30} color={colors.accent700} />
          </View>
          <Text style={styles.confirmedTitle}>Booked (demo)</Text>
          <Text style={styles.confirmedCode}>Confirmation {code}</Text>
          <Text style={styles.confirmedBody}>
            This is a demo booking — no real reservation, payment, or ticket was created. Once booking is live,
            this trip would show up under Trips and be watched for disruptions automatically.
          </Text>
          <Button label="Done" onPress={() => navigation.popToTop()} style={styles.doneButton} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <View style={styles.content}>
        <Eyebrow>Review & book</Eyebrow>
        <Text style={styles.heading}>Confirm this {config.label.slice(0, -1).toLowerCase()}</Text>

        <ItemComponent item={item} />

        <BlueprintCard style={styles.noticeCard}>
          <View style={styles.noticeRow}>
            <Ionicons name="information-circle-outline" size={18} color={colors.accent700} />
            <Text style={styles.noticeText}>
              Demo booking — this confirms nothing for real. Payment and ticketing aren't wired up yet.
            </Text>
          </View>
        </BlueprintCard>

        <Button label="Confirm booking (demo)" onPress={() => setConfirmed(true)} style={styles.confirmButton} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, padding: spacing.lg },
  heading: { ...typography.heading, fontSize: 22, color: colors.text, marginTop: 4, marginBottom: spacing.lg },
  noticeCard: { marginTop: spacing.lg, backgroundColor: colors.bg },
  noticeRow: { flexDirection: 'row', gap: spacing.sm + 2, alignItems: 'flex-start' },
  noticeText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: colors.textSecondary },
  confirmButton: { marginTop: spacing.xl },
  confirmedWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.neutral100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  confirmedTitle: { ...typography.heading, fontSize: 20, color: colors.text, marginBottom: spacing.xs },
  confirmedCode: {
    ...typography.headingMedium,
    fontSize: 15,
    color: colors.accent700,
    marginBottom: spacing.lg,
    letterSpacing: 1,
  },
  confirmedBody: { fontSize: 13.5, lineHeight: 20, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xl },
  doneButton: { minWidth: 160 },
});
