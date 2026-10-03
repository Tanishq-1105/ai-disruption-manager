import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CATEGORIES } from '../config/categories.js';
import { colors, spacing, radius, typography } from '../theme/index.js';
import { BlueprintCard, Button, Eyebrow, SegmentedControl } from '../components/ui/index.js';
import { DateField } from '../components/DateField.js';
import { AirportAutocomplete } from '../components/AirportAutocomplete.js';
import { flightSearchError, withDefaultFlightDate } from '../utils/flightSearch.js';

const CATEGORY_OPTIONS = Object.keys(CATEGORIES).map((key) => ({ key, label: CATEGORIES[key].label }));

export default function SearchScreen({ navigation, route }) {
  const [category, setCategory] = useState(route.params?.category || 'flights');
  const [values, setValues] = useState({});
  const [airports, setAirports] = useState({});
  const [formError, setFormError] = useState('');

  const config = CATEGORIES[category];

  function setCategoryAndReset(key) {
    setCategory(key);
    setValues({});
    setAirports({});
    setFormError('');
  }

  function swapOriginDestination() {
    setValues((v) => ({ ...v, origin: v.destination || '', destination: v.origin || '' }));
    setAirports((v) => ({ ...v, origin: v.destination || null, destination: v.origin || null }));
    setFormError('');
  }

  function setAirport(fieldKey, airport) {
    setAirports((v) => ({ ...v, [fieldKey]: airport }));
    setValues((v) => ({ ...v, [fieldKey]: airport?.iata_code || '' }));
    setFormError('');
  }

  function setDateValue(field, iso) {
    setValues((v) => {
      const next = { ...v, [field.key]: iso };
      // a later checkIn can strand an earlier checkOut — drop it so minDate stays honest
      if (field.key === 'checkIn' && next.checkOut && next.checkOut < iso) next.checkOut = '';
      return next;
    });
  }

  function submit() {
    const params = category === 'flights' ? withDefaultFlightDate(values) : values;
    if (category === 'flights') {
      const validationError = flightSearchError(params);
      if (validationError) {
        setFormError(validationError);
        return;
      }
    }
    navigation.navigate('Results', { category, params });
  }

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Eyebrow>ROUTE BUILDER · 01</Eyebrow>
        <Text style={styles.heading}>Where to next?</Text>
        <Text style={styles.intro}>Choose your route and we’ll find the way there.</Text>

        <SegmentedControl options={CATEGORY_OPTIONS} value={category} onChange={setCategoryAndReset} />

        <View style={styles.fields}>
          <View style={styles.fieldsHeader}>
            <View style={styles.fieldsTitleGroup}>
              <View style={styles.fieldsGlyph}><Ionicons name={CATEGORY_OPTIONS.find(option => option.key === category)?.key === 'flights' ? 'airplane' : 'navigate'} size={15} color={colors.accent800} /></View>
              <Text style={styles.fieldsTitle}>{category === 'flights' ? 'Flight route' : `${config.label} details`}</Text>
            </View>
            <Text style={styles.fieldsIndex}>01 / 03</Text>
          </View>
          {config.searchFields.map((field) => {
            const isSwappable = category === 'flights' && (field.key === 'origin' || field.key === 'destination');
            return (
              <View key={field.key} style={styles.fieldGroup}>
                <Text style={styles.label}>{field.label}</Text>
                {field.type === 'date' ? (
                  <DateField
                    value={values[field.key] || ''}
                    onChange={(iso) => setDateValue(field, iso)}
                    placeholder={field.placeholder}
                    minDate={field.minDate ? field.minDate(values) : undefined}
                  />
                ) : category === 'flights' && isSwappable ? (
                  <AirportAutocomplete
                    value={airports[field.key] || null}
                    onSelect={(airport) => setAirport(field.key, airport)}
                    onClear={() => setAirport(field.key, null)}
                  />
                ) : (
                  <View style={styles.inputRow}>
                    <TextInput
                      style={styles.input}
                      placeholderTextColor={colors.textMuted}
                      value={values[field.key] || ''}
                      autoCapitalize={field.autoCapitalize || 'none'}
                      onChangeText={(text) => setValues((v) => ({ ...v, [field.key]: text }))}
                    />
                    {isSwappable && field.key === 'destination' ? (
                      <Pressable style={styles.swapButton} onPress={swapOriginDestination} hitSlop={8}>
                        <Ionicons name="swap-vertical" size={18} color={colors.accent700} />
                      </Pressable>
                    ) : null}
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {formError ? <Text style={styles.formError}>{formError}</Text> : null}

        <BlueprintCard style={styles.notice}>
          <View style={styles.noticeRow}>
            <View style={styles.noticeIcon}><Ionicons name="shield-checkmark" size={15} color={colors.accent800} /></View>
            <Text style={styles.noticeText}>
              {category === 'flights'
                ? 'Sandbox flight. Confirmed Duffel bookings appear in Protected Trips.'
                : 'Hotel and cab results are sample listings. Booking is not connected yet.'}
            </Text>
          </View>
        </BlueprintCard>

        <Button label={`Search ${config.label}`} onPress={submit} style={styles.submitButton} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xxxl },
  heading: { ...typography.heading, fontSize: 30, lineHeight: 36, color: colors.text, marginTop: spacing.xs, marginBottom: spacing.xs },
  intro: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: spacing.lg },
  fields: { marginTop: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider, padding: spacing.md },
  fieldsHeader: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  fieldsTitleGroup: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fieldsGlyph: { width: 28, height: 28, borderRadius: radius.sm, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  fieldsTitle: { ...typography.headingMedium, fontSize: 15, color: colors.text },
  fieldsIndex: { color: colors.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  fieldGroup: { marginBottom: spacing.md },
  label: { fontSize: 10, fontWeight: '800', color: colors.textMuted, marginBottom: spacing.xs + 2, letterSpacing: 0.9 },
  formError: { color: colors.danger, fontSize: 13, marginTop: spacing.sm, marginBottom: spacing.xs },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
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
  swapButton: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.neutral100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: { marginTop: spacing.md, backgroundColor: colors.bgTint, borderWidth: 0 },
  noticeRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  noticeIcon: { width: 26, height: 26, borderRadius: radius.sm, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  noticeText: { flex: 1, fontSize: 11, lineHeight: 16, color: colors.textSecondary },
  submitButton: { marginTop: spacing.lg },
});
