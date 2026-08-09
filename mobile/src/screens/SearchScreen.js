import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ScrollView } from 'react-native';
import { CATEGORIES } from '../config/categories.js';

const CATEGORY_KEYS = Object.keys(CATEGORIES);

export default function SearchScreen({ navigation }) {
  const [category, setCategory] = useState('flights');
  const [values, setValues] = useState({});

  const config = CATEGORIES[category];

  function setCategoryAndReset(key) {
    setCategory(key);
    setValues({});
  }

  function submit() {
    navigation.navigate('Results', { category, params: values });
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Search</Text>

      <View style={styles.segmentRow}>
        {CATEGORY_KEYS.map((key) => (
          <Pressable
            key={key}
            onPress={() => setCategoryAndReset(key)}
            style={[styles.segment, category === key && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, category === key && styles.segmentTextActive]}>
              {CATEGORIES[key].label}
            </Text>
          </Pressable>
        ))}
      </View>

      {config.searchFields.map((field) => (
        <View key={field.key} style={styles.fieldGroup}>
          <Text style={styles.label}>{field.label}</Text>
          <TextInput
            style={styles.input}
            value={values[field.key] || ''}
            autoCapitalize={field.autoCapitalize || 'none'}
            onChangeText={(text) => setValues((v) => ({ ...v, [field.key]: text }))}
          />
        </View>
      ))}

      <Pressable style={styles.submitButton} onPress={submit}>
        <Text style={styles.submitText}>Search {config.label}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f5f7' },
  content: { padding: 16 },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 16 },
  segmentRow: { flexDirection: 'row', backgroundColor: '#e6e8ec', borderRadius: 10, padding: 4, marginBottom: 20 },
  segment: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segmentActive: { backgroundColor: '#fff' },
  segmentText: { color: '#666', fontWeight: '500' },
  segmentTextActive: { color: '#111' },
  fieldGroup: { marginBottom: 14 },
  label: { fontSize: 13, color: '#555', marginBottom: 6 },
  input: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  submitButton: { backgroundColor: '#1a73e8', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
