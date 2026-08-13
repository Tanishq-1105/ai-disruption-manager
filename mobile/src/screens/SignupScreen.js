import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext.js';
import { colors, spacing, radius, typography } from '../theme/index.js';
import { Button } from '../components/ui/index.js';

export default function SignupScreen({ navigation }) {
  const { signup } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      await signup(email, password);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <View style={styles.content}>
        <Text style={styles.heading}>Sign up</Text>
        <Text style={styles.subheading}>Password must be at least 8 characters.</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          label={submitting ? 'Creating account…' : 'Sign up'}
          onPress={submit}
          loading={submitting}
          style={styles.button}
        />

        <Pressable onPress={() => navigation.navigate('Login')}>
          <Text style={styles.link}>Already have an account? Log in</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, padding: spacing.xxl, justifyContent: 'center' },
  heading: { ...typography.heading, fontSize: 24, color: colors.text, marginBottom: spacing.xs + 2 },
  subheading: { fontSize: 14, color: colors.textSecondary, marginBottom: spacing.xxl },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
    fontSize: 15,
    color: colors.text,
    marginBottom: spacing.md,
  },
  error: { color: colors.danger, marginBottom: spacing.md, fontSize: 13 },
  button: { marginTop: spacing.xs },
  link: { color: colors.accent700, textAlign: 'center', marginTop: spacing.xl, fontSize: 14 },
});
