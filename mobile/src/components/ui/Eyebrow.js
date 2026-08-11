import { Text, StyleSheet } from 'react-native';
import { colors, typography } from '../../theme/index.js';

export function Eyebrow({ children, tone = 'muted', style }) {
  return (
    <Text style={[styles.base, { color: tone === 'accent' ? colors.accent700 : colors.textMuted }, style]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: { ...typography.eyebrow },
});
