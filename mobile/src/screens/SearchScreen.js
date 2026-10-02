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
        <Eyebrow>Search</Eyebrow>
        <Text style={styles.heading}>Where to?</Text>

        <SegmentedControl options={CATEGORY_OPTIONS} value={category} onChange={setCategoryAndReset} />

        <View style={styles.fields}>
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
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.accent700} />
            <Text style={styles.noticeText}>
              {category === 'flights'
                ? 'Confirm a Duffel sandbox flight to save it to Protected Trips. Automatic trip recovery is not connected yet.'
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
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  heading: { ...typography.heading, fontSize: 24, color: colors.text, marginTop: 4, marginBottom: spacing.lg },
  fields: { marginTop: spacing.xl },
  fieldGroup: { marginBottom: spacing.md + 2 },
  label: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.xs + 2 },
  formError: { color: colors.danger, fontSize: 13, marginTop: -spacing.xs, marginBottom: spacing.sm },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 15,
    color: colors.text,
  },
  swapButton: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.neutral100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: { marginTop: spacing.md, backgroundColor: colors.bg },
  noticeRow: { flexDirection: 'row', gap: spacing.sm + 2, alignItems: 'flex-start' },
  noticeText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: colors.textSecondary },
  submitButton: { marginTop: spacing.xl },
});
