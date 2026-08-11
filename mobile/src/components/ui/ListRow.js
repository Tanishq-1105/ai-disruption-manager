import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing } from '../../theme/index.js';

export function ListRow({ icon, title, subtitle, meta, onPress }) {
  const Wrapper = onPress ? Pressable : View;

  return (
    <Wrapper onPress={onPress} style={styles.row}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <View style={styles.textCol}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingVertical: spacing.sm + 2,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  icon: { width: 22, alignItems: 'center' },
  textCol: { flex: 1 },
  title: { fontSize: 14, color: colors.text },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  meta: { fontSize: 12, color: colors.textMuted, marginLeft: spacing.sm },
});
