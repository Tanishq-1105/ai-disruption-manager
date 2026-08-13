import { useEffect, useState } from 'react';
import { View, Text, TextInput, Switch, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext.js';
import { colors, spacing, radius, typography } from '../theme/index.js';
import { BlueprintCard, Eyebrow } from '../components/ui/index.js';

const LIMITS_KEY = 'autonomy_limits_v1';
const DEFAULT_LIMITS = { fareCap: '150', arrivalCapHours: '12', cabinDowngrade: false, overnightStay: false };
const DEFAULT_CHANNELS = { whatsapp: false, email: true, sms: false };

// Writes the policy profile the agent's policy engine will read before
// acting alone on a disruption (see CLAUDE.md §"Bounded autonomy"). Stored
// locally for now — there's no backend profile endpoint yet since the
// booking/disruption flow this feeds isn't wired up (Build notes, 05–12).
export default function YouScreen() {
  const { user, logout } = useAuth();
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [channels, setChannels] = useState(DEFAULT_CHANNELS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const stored = await SecureStore.getItemAsync(LIMITS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setLimits({ ...DEFAULT_LIMITS, ...parsed.limits });
        setChannels({ ...DEFAULT_CHANNELS, ...parsed.channels });
      }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    SecureStore.setItemAsync(LIMITS_KEY, JSON.stringify({ limits, channels }));
  }, [limits, channels, loaded]);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Eyebrow>You</Eyebrow>
        <Text style={styles.heading}>Autonomy limits</Text>

        {user ? (
          <BlueprintCard style={styles.accountCard}>
            <View style={styles.accountRow}>
              <View style={styles.accountIcon}>
                <Ionicons name="person-outline" size={18} color={colors.accent700} />
              </View>
              <Text style={styles.accountEmail} numberOfLines={1}>
                {user.email}
              </Text>
            </View>
            <Pressable onPress={logout}>
              <Text style={styles.logout}>Log out</Text>
            </Pressable>
          </BlueprintCard>
        ) : null}

        <Text style={styles.sectionTitle}>What the agent may do without asking</Text>
        <BlueprintCard style={styles.card}>
          <View style={styles.limitRow}>
            <View style={styles.limitText}>
              <Text style={styles.limitLabel}>Extra fare cap</Text>
              <Text style={styles.limitHint}>Rebook alone up to this much more than the original fare</Text>
            </View>
            <View style={styles.limitInputWrap}>
              <Text style={styles.limitPrefix}>$</Text>
              <TextInput
                style={styles.limitInput}
                keyboardType="number-pad"
                value={limits.fareCap}
                onChangeText={(v) => setLimits((l) => ({ ...l, fareCap: v.replace(/[^0-9]/g, '') }))}
              />
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.limitRow}>
            <View style={styles.limitText}>
              <Text style={styles.limitLabel}>Later-arrival cap</Text>
              <Text style={styles.limitHint}>Rebook alone if the new arrival is within this many hours</Text>
            </View>
            <View style={styles.limitInputWrap}>
              <TextInput
                style={styles.limitInput}
                keyboardType="number-pad"
                value={limits.arrivalCapHours}
                onChangeText={(v) => setLimits((l) => ({ ...l, arrivalCapHours: v.replace(/[^0-9]/g, '') }))}
              />
              <Text style={styles.limitSuffix}>hrs</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <ToggleRow
            label="Cabin downgrade"
            hint="Allow a lower cabin if nothing in the same cabin works"
            value={limits.cabinDowngrade}
            onChange={(v) => setLimits((l) => ({ ...l, cabinDowngrade: v }))}
          />
          <View style={styles.divider} />
          <ToggleRow
            label="Overnight stay"
            hint="Allow a hotel add if the replacement requires one"
            value={limits.overnightStay}
            onChange={(v) => setLimits((l) => ({ ...l, overnightStay: v }))}
          />
          <View style={styles.divider} />
          <ToggleRow
            label="Trip cancellation"
            hint="Always escalated to you — this can't be turned off"
            value
            locked
          />
        </BlueprintCard>

        <Text style={styles.sectionTitle}>Notification channels</Text>
        <BlueprintCard style={styles.card}>
          <ToggleRow label="In-app card" hint="Always on — the fallback that always works" value locked />
          <View style={styles.divider} />
          <ToggleRow
            label="WhatsApp"
            value={channels.whatsapp}
            onChange={(v) => setChannels((c) => ({ ...c, whatsapp: v }))}
          />
          <View style={styles.divider} />
          <ToggleRow label="Email" value={channels.email} onChange={(v) => setChannels((c) => ({ ...c, email: v }))} />
          <View style={styles.divider} />
          <ToggleRow label="SMS" value={channels.sms} onChange={(v) => setChannels((c) => ({ ...c, sms: v }))} />
        </BlueprintCard>

        <Text style={styles.footnote}>
          Limits apply on the next disruption, never mid-recovery. The audit trail of automatic actions will appear
          here once the agent's execution layer is connected.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function ToggleRow({ label, hint, value, onChange, locked = false }) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.limitText}>
        <Text style={styles.limitLabel}>{label}</Text>
        {hint ? <Text style={styles.limitHint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={locked}
        trackColor={{ false: colors.neutral100, true: colors.accent }}
        thumbColor={colors.white}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  heading: { ...typography.heading, fontSize: 24, color: colors.text, marginTop: 4, marginBottom: spacing.lg },
  accountCard: {
    marginBottom: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, flexShrink: 1 },
  accountIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.neutral100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountEmail: { fontSize: 14, color: colors.text, flexShrink: 1 },
  logout: { color: colors.danger, fontWeight: '600', fontSize: 13 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginBottom: spacing.sm },
  card: { marginBottom: spacing.xl },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.md },
  limitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  limitText: { flex: 1 },
  limitLabel: { fontSize: 14, color: colors.text, fontWeight: '600' },
  limitHint: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  limitInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.neutral100,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 2,
  },
  limitPrefix: { fontSize: 14, color: colors.textSecondary, marginRight: 2 },
  limitSuffix: { fontSize: 12, color: colors.textSecondary, marginLeft: 2 },
  limitInput: { width: 44, paddingVertical: spacing.sm, fontSize: 15, color: colors.text, textAlign: 'right' },
  footnote: { fontSize: 12, color: colors.textMuted, lineHeight: 18, marginTop: spacing.sm },
});
