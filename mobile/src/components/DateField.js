import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme/index.js';
import { DatePickerSheet } from './DatePickerSheet.js';
import { formatDisplayDate } from '../utils/date.js';

export function DateField({ value, onChange, minDate, placeholder = 'Select date' }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable style={styles.field} onPress={() => setOpen(true)}>
        <Text style={[styles.text, !value && styles.placeholder]}>{value ? formatDisplayDate(value) : placeholder}</Text>
        <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
      </Pressable>

      <DatePickerSheet
        visible={open}
        onClose={() => setOpen(false)}
        selectedDate={value || null}
        minDate={minDate}
        onSelect={onChange}
      />
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  text: { fontSize: 15, color: colors.text },
  placeholder: { color: colors.textMuted },
});
