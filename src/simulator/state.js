import { randomUUID } from 'node:crypto';

// In-memory only — this is the "doing" half CLAUDE.md describes: cancellation,
// seat scarcity, booking, and injected failures, all under our control since
// no airline gives sandbox access to reissue a real ticket.
const trips = new Map(); // tripId -> { id, flights: [] }
const bookings = new Map(); // bookingId -> booking
const idempotencyResults = new Map(); // idempotencyKey -> bookingId

let forceNextBookingFailure = false;

function requireTrip(tripId) {
  const trip = trips.get(tripId);
  if (!trip) throw new Error(`Unknown trip ${tripId}`);
  return trip;
}

function requireFlight(tripId, flightId) {
  const flight = requireTrip(tripId).flights.find((f) => f.id === flightId);
  if (!flight) throw new Error(`Unknown flight ${flightId} on trip ${tripId}`);
  return flight;
}

export function seedInventory(tripId, flights) {
  trips.set(tripId, {
    id: tripId,
    flights: flights.map((f) => ({ status: 'CONFIRMED', ...f })),
  });
  return trips.get(tripId);
}

// Control-panel trigger: cancel button.
export function cancelFlight(tripId, flightId) {
  const flight = requireFlight(tripId, flightId);
  flight.status = 'CANCELLED';
  return flight;
}

// Control-panel trigger: delay button — shifts projected arrival so
// detection.js can compare it against the next leg's departure.
export function delayFlight(tripId, flightId, minutes) {
  const flight = requireFlight(tripId, flightId);
  flight.delayMinutes = minutes;
  flight.projectedArrival = new Date(
    new Date(flight.scheduledArrival).getTime() + minutes * 60_000
  ).toISOString();
  return flight;
}

// Control-panel trigger: fail button — arms a forced failure on the next
// booking attempt, so the demo can show the agent keeping the old ticket
// and retrying instead of releasing it.
export function setForceNextBookingFailure(value) {
  forceNextBookingFailure = value;
}

// Every mutating booking request carries an idempotency key so a network
// retry can never cause a double booking.
export function bookFlight({ tripId, option, idempotencyKey }) {
  if (idempotencyResults.has(idempotencyKey)) {
    return bookings.get(idempotencyResults.get(idempotencyKey));
  }

  if (forceNextBookingFailure) {
    forceNextBookingFailure = false;
    throw new Error('Simulated booking failure');
  }

  const booking = {
    id: randomUUID(),
    tripId,
    option,
    status: 'CONFIRMED',
    createdAt: new Date().toISOString(),
  };
  bookings.set(booking.id, booking);
  idempotencyResults.set(idempotencyKey, booking.id);
  return booking;
}

export function cancelBooking(bookingId) {
  const booking = bookings.get(bookingId);
  if (!booking) throw new Error(`Unknown booking ${bookingId}`);
  booking.status = 'CANCELLED';
  return booking;
}

export function getState() {
  return {
    trips: Array.from(trips.values()),
    bookings: Array.from(bookings.values()),
  };
}

export function _resetForTests() {
  trips.clear();
  bookings.clear();
  idempotencyResults.clear();
  forceNextBookingFailure = false;
}
