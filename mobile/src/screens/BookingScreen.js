import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext.js';
import { getFlightQuote, bookFlight, getTrip } from '../api/endpoints.js';
import { FlightItem } from '../components/FlightItem.js';
import { colors, spacing, radius, typography } from '../theme/index.js';
import { BlueprintCard, Eyebrow, Button, Tag, SegmentedControl } from '../components/ui/index.js';

const emptyPassenger = {
  given_name: '', family_name: '', born_on: '', email: '', phone_number: '', title: 'mr', gender: 'm',
  passport: { number: '', country: '', expiresOn: '' },
};
const testPassenger = {
  given_name: 'Test', family_name: 'Traveller', born_on: '1990-01-01', email: 'test@example.com',
  phone_number: '+442080160509', title: 'mr', gender: 'm',
  passport: { number: '123456789', country: 'GB', expiresOn: '2035-01-01' },
};

export default function BookingScreen({ route, navigation }) {
  const { category, item } = route.params;
  const { user } = useAuth();
  const supported = category === 'flights' && item.source === 'duffel';
  const [quote, setQuote] = useState(null);
  const [booking, setBooking] = useState(null);
  const [passenger, setPassenger] = useState(emptyPassenger);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submitting = useRef(false);
  const request = useRef(0);

  const loadQuote = useCallback(async () => {
    if (!user || !supported) return;
    const current = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const result = await getFlightQuote(item.offerId ?? item.id);
      if (current !== request.current) return;
      setQuote(result);
      setBooking(result.status === 'QUOTED' ? null : result);
    } catch (err) {
      if (current === request.current) setError(err.response?.data?.error ?? 'Could not load this fare. Please try again.');
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, [user?.id, supported, item.offerId, item.id]);

  useEffect(() => {
    setQuote(null);
    setBooking(null);
    setPassenger({ ...emptyPassenger, email: user?.email ?? '' });
    loadQuote();
    return () => { request.current += 1; };
  }, [loadQuote]);

  function acceptStatus(result) {
    if (result.status === 'QUOTED') { setQuote(result); setBooking(null); }
    else setBooking(result);
  }

  async function submit() {
    if (!quote || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try { acceptStatus(await bookFlight(quote, passenger)); }
    catch (err) {
      if (err.response?.data?.quote) setQuote(err.response.data.quote);
      // A timeout may hide an order: read its saved request before another POST.
      if (!err.response || err.response.status >= 500) {
        try { acceptStatus(await getTrip(quote.id)); }
        catch { setBooking({ ...quote, status: 'REVIEW_REQUIRED', message: 'Your booking needs a status check. Do not book again yet.' }); }
      }
      setError(err.response?.data?.error ?? 'Connection interrupted. Check the booking status before trying again.');
    } finally { submitting.current = false; setBusy(false); }
  }

  async function checkStatus() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try { acceptStatus(await getTrip(booking.id)); }
    catch (err) { setError(err.response?.data?.error ?? 'Could not check the booking. Please try again.'); }
    finally { submitting.current = false; setBusy(false); }
  }

  function viewTrips() {
    navigation.popToTop();
    navigation.getParent()?.navigate('Trips', { screen: 'ProtectedTrips' });
  }
  const search = () => navigation.navigate('SearchHome', { category: 'flights' });
  const field = (key, label, placeholder, options = {}) => (
    <View style={styles.field} key={key}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} accessibilityLabel={label} placeholder={placeholder}
        placeholderTextColor={colors.textMuted} value={passenger[key]} editable={!busy}
        onChangeText={value => setPassenger(current => ({ ...current, [key]: value }))} {...options} />
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={96}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Eyebrow>{supported ? 'Duffel sandbox' : 'Booking unavailable'}</Eyebrow>
          {!supported ? <>
            <Text style={styles.heading}>Choose a sandbox flight</Text>
            <Text style={styles.body}>Flight checkout is available for Duffel offers. Hotel, cab, and Sabre bookings are not connected yet.</Text>
            <Button label="Search flights" onPress={search} />
          </> : !user ? <>
            <Text style={styles.heading}>Sign in to save your trip</Text>
            <FlightItem item={item} />
            <Text style={styles.body}>Your confirmed sandbox booking will be added to Protected Trips in your account.</Text>
            <Button label="Sign in to continue" onPress={() => navigation.navigate('Login', { returnTo: 'Booking' })} />
          </> : booking ? <>
            <Ionicons name={booking.status === 'CONFIRMED' ? 'checkmark-circle' : 'information-circle-outline'} size={46} color={colors.accent700} style={styles.icon} />
            <Text style={styles.heading}>{booking.status === 'CONFIRMED' ? 'Your sandbox flight is booked' : booking.status === 'FAILED' ? 'Flight could not be booked' : booking.status === 'CANCELLED' ? 'Booking cancelled' : 'Checking your booking'}</Text>
            {booking.bookingReference ? <Text style={styles.reference}>Booking reference: {booking.bookingReference}</Text> : null}
            <FlightItem item={{ ...booking.flight, price: booking.total }} />
            <Text style={styles.body}>{booking.status === 'CONFIRMED'
              ? 'Added to Protected Trips automatically. This is a test reservation with no real ticket or charge.'
              : booking.message ?? 'Confirmation is pending. Check the status before booking another flight.'}</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {['BOOKING', 'PENDING', 'REVIEW_REQUIRED'].includes(booking.status)
              ? <Button label="Check status" loading={busy} onPress={checkStatus} style={styles.button} /> : null}
            <Button label="View protected trips" onPress={viewTrips} style={styles.button} />
            {booking.status === 'FAILED' ? <Button label="Search another flight" variant="secondary" onPress={search} /> : null}
          </> : <>
            <Text style={styles.heading}>Review & book</Text>
            <FlightItem item={quote?.flight ?? item} />
            <BlueprintCard style={styles.notice}><Text style={styles.bodySmall}>Sandbox reservation · one adult (18+). Use test passenger details. No real ticket or charge.</Text></BlueprintCard>
            {loading || !quote ? <Button label="Refresh fare" loading={loading} onPress={loadQuote} style={styles.button} /> : <>
              <Text style={styles.total}>Total: {quote.total.currency} {quote.total.amount}</Text>
              <Text style={styles.bodySmall}>Offer expires at {new Date(quote.expiresAt).toLocaleTimeString()}. We check the fare again before booking.</Text>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Passenger details</Text>
                <Button label="Use test passenger" variant="ghost" disabled={busy} onPress={() => setPassenger(testPassenger)} />
              </View>
              <Text style={styles.label}>Title</Text>
              <View style={styles.tags}>{['mr', 'ms', 'mrs', 'miss', 'dr'].map(title => <Tag key={title} label={title.toUpperCase()}
                variant={passenger.title === title ? 'solid' : 'neutral'}
                onPress={() => { if (!busy) setPassenger(current => ({ ...current, title })); }} />)}</View>
              {field('given_name', 'First name', 'As shown on the travel document')}
              {field('family_name', 'Last name', 'As shown on the travel document')}
              {field('born_on', 'Date of birth', 'YYYY-MM-DD', { autoCapitalize: 'none', maxLength: 10 })}
              <Text style={styles.label}>Gender for airline booking</Text>
              <SegmentedControl options={[{ key: 'm', label: 'Male' }, { key: 'f', label: 'Female' }]} value={passenger.gender}
                onChange={gender => { if (!busy) setPassenger(current => ({ ...current, gender })); }} />
              {field('email', 'Email', 'traveller@example.com', { keyboardType: 'email-address', autoCapitalize: 'none' })}
              {field('phone_number', 'Phone with country code', '+442080160509', { keyboardType: 'phone-pad' })}
              {quote.requiresPassport ? <>
                <Text style={styles.sectionTitle}>Passport required for this flight</Text>
                {[['number', 'Passport number'], ['country', 'Country code (e.g. GB)'], ['expiresOn', 'Expiry date (YYYY-MM-DD)']].map(([key, label]) => <View key={key} style={styles.field}>
                  <Text style={styles.label}>{label}</Text>
                  <TextInput style={styles.input} accessibilityLabel={label} value={passenger.passport[key]} editable={!busy}
                    autoCapitalize={key === 'country' ? 'characters' : 'none'}
                    onChangeText={value => setPassenger(current => ({ ...current, passport: { ...current.passport, [key]: key === 'country' ? value.toUpperCase() : value } }))} />
                </View>)}
              </> : null}
              <Button label={`Confirm sandbox booking · ${quote.total.currency} ${quote.total.amount}`} loading={busy} onPress={submit} style={styles.button} />
            </>}
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            {!quote && !loading ? <Button label="Search another flight" variant="ghost" onPress={search} /> : null}
          </>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  heading: { ...typography.heading, fontSize: 23, color: colors.text, marginTop: spacing.sm, marginBottom: spacing.lg },
  body: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, marginBottom: spacing.lg },
  bodySmall: { fontSize: 12.5, lineHeight: 19, color: colors.textSecondary },
  notice: { marginVertical: spacing.sm },
  total: { ...typography.headingMedium, fontSize: 18, color: colors.accent700, marginTop: spacing.md, marginBottom: spacing.xs },
  sectionHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg },
  sectionTitle: { ...typography.headingMedium, fontSize: 16, color: colors.text, marginVertical: spacing.sm },
  field: { marginTop: spacing.md },
  label: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.xs, marginTop: spacing.sm },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider, borderRadius: radius.md, padding: spacing.md, color: colors.text, fontSize: 15 },
  tags: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  button: { marginTop: spacing.lg, marginBottom: spacing.sm },
  error: { color: colors.danger, fontSize: 13, lineHeight: 20, marginTop: spacing.md },
  reference: { ...typography.headingMedium, fontSize: 16, color: colors.accent700, marginBottom: spacing.lg },
  icon: { marginTop: spacing.lg },
});
