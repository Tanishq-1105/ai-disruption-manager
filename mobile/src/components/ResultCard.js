import { useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { QuickBookSheet } from './QuickBookSheet.js';

const LONG_PRESS_MS = 2200;

// Wraps a result row (FlightItem/HotelItem/CabItem) with the interaction the
// rest of the OTA-style flow needs: a short tap opens full details, a ~2s
// hold grows the card and offers a shortcut straight to the (demo) booking screen.
export function ResultCard({ item, category, config, navigation }) {
  const scale = useRef(new Animated.Value(1)).current;
  const longPressFired = useRef(false);
  const [quickBookVisible, setQuickBookVisible] = useState(false);

  function handlePressIn() {
    longPressFired.current = false;
    Animated.timing(scale, { toValue: 1.06, duration: LONG_PRESS_MS, useNativeDriver: true }).start();
  }

  function handlePressOut() {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 5 }).start();
  }

  function handleLongPress() {
    longPressFired.current = true;
    Animated.sequence([
      Animated.timing(scale, { toValue: 1.12, duration: 120, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1.04, useNativeDriver: true, friction: 4 }),
    ]).start();
    setQuickBookVisible(true);
  }

  function handlePress() {
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    navigation.navigate('ItemDetails', { category, item });
  }

  return (
    <>
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onLongPress={handleLongPress}
        delayLongPress={LONG_PRESS_MS}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <Animated.View style={{ transform: [{ scale }] }}>
          <config.ItemComponent item={item} />
        </Animated.View>
      </Pressable>

      <QuickBookSheet
        visible={quickBookVisible}
        item={item}
        config={config}
        onClose={() => setQuickBookVisible(false)}
        onViewDetails={() => {
          setQuickBookVisible(false);
          navigation.navigate('ItemDetails', { category, item });
        }}
        onBook={() => {
          setQuickBookVisible(false);
          navigation.navigate('Booking', { category, item });
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.92 },
});
