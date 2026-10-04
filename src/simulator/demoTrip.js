export const DEMO_TRIP_ID = 'demo-trip';

// A realistic ripple: outbound leg -> connecting leg -> hotel -> ground
// transport, plus a commitment that depends on the hotel. Cancelling or
// delaying flight-out is enough to cascade through the whole chain.
//
// Two deliberate choices make this fixture demo-ready:
//
// - The outbound leg is JFK-LAX, the only route with cached data on this Sabre
//   account, so cancelling it produces REAL replacement options rather than an
//   empty list. Everything downstream is simulated either way.
// - Dates are generated relative to now instead of hard-coded, so the demo
//   never silently breaks by drifting into the past.

const DAYS_AHEAD = 30;

// Duffel test mode quotes EUR. The fixture must use the same currency as the
// active search provider, or the policy engine will refuse to compare a
// replacement fare against the original — correctly, since guessing an
// exchange rate is not a decision the member delegated.
const CURRENCY = process.env.POLICY_COST_CAP_CURRENCY || 'EUR';

function at(dayOffset, time) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + DAYS_AHEAD + dayOffset);
  return `${d.toISOString().slice(0, 10)}T${time}`;
}

/** The date the outbound leg departs — what the recovery search asks Sabre for. */
export function demoDepartureDate() {
  return at(0, '00:00:00Z').slice(0, 10);
}

export function buildDemoTrip() {
  return [
    {
      id: 'flight-out',
      type: 'FLIGHT',
      // Carries a booking so the executor has a real old ticket to release.
      bookingId: 'demo-booking-flight-out',
      origin: 'JFK',
      destination: 'LAX',
      scheduledDeparture: at(0, '11:00:00Z'),
      scheduledArrival: at(0, '17:00:00Z'),
      departureOffsetHours: -4,
      arrivalOffsetHours: -7,
      cabin: 'ECONOMY',
      price: { amount: 200, currency: CURRENCY },
      reversible: true,
      refundable: true,
      dependsOn: [],
    },
    {
      id: 'flight-connect',
      type: 'FLIGHT',
      bookingId: 'demo-booking-flight-connect',
      origin: 'LAX',
      destination: 'SFO',
      scheduledDeparture: at(0, '19:00:00Z'),
      scheduledArrival: at(0, '20:30:00Z'),
      departureOffsetHours: -7,
      arrivalOffsetHours: -8,
      cabin: 'ECONOMY',
      price: { amount: 120, currency: CURRENCY },
      reversible: true,
      refundable: true,
      dependsOn: ['flight-out'],
    },
    {
      id: 'hotel-sfo',
      type: 'HOTEL',
      name: 'SFO Marriott',
      checkIn: at(0, '22:00:00Z'),
      checkOut: at(2, '11:00:00Z'),
      reversible: true,
      refundable: true,
      dependsOn: ['flight-connect'],
    },
    {
      id: 'car-sfo',
      type: 'GROUND',
      provider: 'RideShare',
      pickupTime: at(0, '21:00:00Z'),
      reversible: true,
      refundable: true,
      dependsOn: ['flight-connect'],
    },
    {
      id: 'meeting-sfo',
      type: 'COMMITMENT',
      label: 'Client meeting',
      time: at(1, '09:00:00Z'),
      reversible: false,
      refundable: false,
      dependsOn: ['hotel-sfo'],
    },
  ];
}
