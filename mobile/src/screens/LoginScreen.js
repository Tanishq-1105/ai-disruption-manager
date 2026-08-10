import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useAuth } from '../context/AuthContext.js';

export default function LoginScreen({ navigation }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>Log in</Text>
      <Text style={styles.subheading}>See your past searches under History.</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={styles.button} onPress={submit} disabled={submitting}>
        <Text style={styles.buttonText}>{submitting ? 'Logging in…' : 'Log in'}</Text>
      </Pressable>

      <Pressable onPress={() => navigation.navigate('Signup')}>
        <Text style={styles.link}>Don't have an account? Sign up</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff', padding: 24, justifyContent: 'center' },
  heading: { fontSize: 24, fontWeight: '700', marginBottom: 6 },
  subheading: { fontSize: 14, color: '#666', marginBottom: 24 },
  input: { backgroundColor: '#f4f5f7', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 12 },
  error: { color: '#c0392b', marginBottom: 12, fontSize: 13 },
  button: { backgroundColor: '#1a73e8', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  link: { color: '#1a73e8', textAlign: 'center', marginTop: 18, fontSize: 14 },
});
