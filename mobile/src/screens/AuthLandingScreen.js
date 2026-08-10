import { View, Text, Pressable, StyleSheet } from 'react-native';

export default function AuthLandingScreen({ navigation }) {
  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>Sign in to see your history</Text>
      <Text style={styles.subheading}>Your past flight, hotel, and cab searches show up here once you're signed in.</Text>

      <Pressable style={styles.button} onPress={() => navigation.navigate('Login')}>
        <Text style={styles.buttonText}>Log in</Text>
      </Pressable>
      <Pressable style={[styles.button, styles.buttonSecondary]} onPress={() => navigation.navigate('Signup')}>
        <Text style={[styles.buttonText, styles.buttonTextSecondary]}>Sign up</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff', padding: 24, justifyContent: 'center' },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  subheading: { fontSize: 14, color: '#666', marginBottom: 28, textAlign: 'center' },
  button: { backgroundColor: '#1a73e8', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  buttonSecondary: { backgroundColor: '#f4f5f7' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  buttonTextSecondary: { color: '#1a73e8' },
});
