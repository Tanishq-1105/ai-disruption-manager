import { useEffect, useState } from 'react';
import { View, Text, Modal, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../theme/index.js';
import { daysInMonth, firstWeekdayOfMonth, fromISO, toISO, todayISO, MONTH_NAMES, WEEKDAY_LABELS } from '../utils/date.js';

// A self-built calendar sheet rather than a native date picker — keeps one
// look across iOS/Android/light/dark instead of the OS's own spinner or
// calendar widget, and needs no extra native dependency in an Expo Go app.
export function DatePickerSheet({ visible, onClose, selectedDate, minDate, onSelect }) {
  const [viewYear, setViewYear] = useState(() => (selectedDate ? fromISO(selectedDate) : minDate ? fromISO(minDate) : new Date()).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (selectedDate ? fromISO(selectedDate) : minDate ? fromISO(minDate) : new Date()).getMonth());

  useEffect(() => {
    if (!visible) return;
    const base = selectedDate ? fromISO(selectedDate) : minDate ? fromISO(minDate) : new Date();
    setViewYear(base.getFullYear());
    setViewMonth(base.getMonth());
  }, [visible, selectedDate, minDate]);

  const min = minDate ? fromISO(minDate) : null;
  const totalDays = daysInMonth(viewYear, viewMonth);
  const startWeekday = firstWeekdayOfMonth(viewYear, viewMonth);
  const cells = [...Array(startWeekday).fill(null), ...Array.from({ length: totalDays }, (_, i) => i + 1)];

  function changeMonth(delta) {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setViewMonth(m);
    setViewYear(y);
  }

  function selectDay(day) {
    onSelect(toISO(new Date(viewYear, viewMonth, day)));
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Pressable onPress={() => changeMonth(-1)} hitSlop={8} style={styles.navButton}>
            <Ionicons name="chevron-back" size={20} color={colors.accent700} />
          </Pressable>
          <Text style={styles.title}>
            {MONTH_NAMES[viewMonth]} {viewYear}
          </Text>
          <Pressable onPress={() => changeMonth(1)} hitSlop={8} style={styles.navButton}>
            <Ionicons name="chevron-forward" size={20} color={colors.accent700} />
          </Pressable>
        </View>

        <View style={styles.weekRow}>
          {WEEKDAY_LABELS.map((label, i) => (
            <Text key={i} style={styles.weekLabel}>
              {label}
            </Text>
          ))}
        </View>

        <View style={styles.grid}>
          {cells.map((day, index) => {
            if (day === null) return <View key={`empty-${index}`} style={styles.cell} />;

            const date = new Date(viewYear, viewMonth, day);
            const iso = toISO(date);
            const disabled = min ? date < min : false;
            const selected = iso === selectedDate;
            const isToday = iso === todayISO();

            return (
              <Pressable
                key={iso}
                style={[styles.cell, selected && styles.cellSelected]}
                disabled={disabled}
                onPress={() => selectDay(day)}
              >
                <Text
                  style={[
                    styles.cellText,
                    disabled && styles.cellTextDisabled,
                    isToday && !selected && styles.cellTextToday,
                    selected && styles.cellTextSelected,
                  ]}
                >
                  {day}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(6, 42, 39, 0.4)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  navButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.neutral100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...typography.headingMedium, fontSize: 16, color: colors.text },
  weekRow: { flexDirection: 'row', marginBottom: spacing.xs },
  weekLabel: { width: `${100 / 7}%`, textAlign: 'center', fontSize: 12, fontWeight: '700', color: colors.textMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  cellSelected: { backgroundColor: colors.accent, borderRadius: radius.pill },
  cellText: { fontSize: 14, color: colors.text },
  cellTextDisabled: { color: colors.textMuted, opacity: 0.4 },
  cellTextToday: { color: colors.accent700, fontWeight: '700' },
  cellTextSelected: { color: colors.white, fontWeight: '700' },
});
