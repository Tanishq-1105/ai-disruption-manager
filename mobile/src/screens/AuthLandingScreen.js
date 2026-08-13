import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, typography } from '../theme/index.js';
import { Button } from '../components/ui/index.js';

const DEFAULT_COPY = {
  heading: 'Sign in to continue',
  subheading: 'Create a free account to keep going.',
};

// Reused as the auth gate for History, Trips, and You — each stack passes
// its own heading/subheading via route params instead of three near-duplicate screens.
export default function AuthLandingScreen({ navigation, route }) {
  const { heading, subheading } = { ...DEFAULT_COPY, ...(route?.params || {}) };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.content}>
        <Text style={styles.heading}>{heading}</Text>
        <Text style={styles.subheading}>{subheading}</Text>

        <Button label="Log in" onPress={() => navigation.navigate('Login')} style={styles.button} />
        <Button
          label="Sign up"
          variant="secondary"
          onPress={() => navigation.navigate('Signup')}
          style={styles.button}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, padding: spacing.xxl, justifyContent: 'center' },
  heading: { ...typography.heading, fontSize: 22, color: colors.text, marginBottom: spacing.sm, textAlign: 'center' },
  subheading: { fontSize: 14, color: colors.textSecondary, marginBottom: spacing.xxl, textAlign: 'center' },
  button: { marginBottom: spacing.sm + 4 },
});
