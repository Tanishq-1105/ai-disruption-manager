import { View, Text, StyleSheet } from 'react-native';

export function CabItem({ item }) {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>{item.provider}</Text>
        <Text style={styles.price}>
          {item.price.currency} {item.price.amount}
        </Text>
      </View>
      <Text style={styles.meta}>{item.etaMinutes} min away · seats {item.capacity}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, borderRadius: 10, backgroundColor: '#fff', marginBottom: 10, elevation: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontWeight: '600', fontSize: 15 },
  price: { fontWeight: '700', fontSize: 14, color: '#1a73e8' },
  meta: { marginTop: 4, fontSize: 12, color: '#777' },
});
