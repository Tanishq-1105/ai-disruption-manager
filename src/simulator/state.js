import { randomUUID } from 'node:crypto';

// In-memory only — this is the "doing" half CLAUDE.md describes: cancellation,
// seat scarcity, booking, and injected failures, all under our control since
// no airline gives sandbox access to reissue a real ticket.
//
// Trip shape matches CLAUDE.md's data model: a trip is a set of linked nodes
// (FLIGHT | GROUND | HOTEL | COMMITMENT), each with `dependsOn` so impact
// analysis can walk what breaks downstream of a disruption.
const trips = new Map(); // tripId -> { id, nodes: [] }
const bookings = new Map(); // bookingId -> booking
const idempotencyResults = new Map(); // idempotencyKey -> bookingId

let forceNextBookingFailure = false;

function requireTrip(tripId) {
  const trip = trips.get(tripId);
  if (!trip) throw new Error(`Unknown trip ${tripId}`);
  return trip;
}

function requireNode(tripId, nodeId) {
  const node = requireTrip(tripId).nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error(`Unknown node ${nodeId} on trip ${tripId}`);
  return node;
}

export function seedTrip(tripId, nodes) {
  trips.set(tripId, {
    id: tripId,
    nodes: nodes.map((n) => ({ status: 'CONFIRMED', dependsOn: [], ...n })),
  });
  return trips.get(tripId);
}

export function getTrip(tripId) {
  return requireTrip(tripId);
}

// Control-panel trigger: cancel button.
export function cancelNode(tripId, nodeId) {
  const node = requireNode(tripId, nodeId);
  node.status = 'CANCELLED';
  return node;
}

// Control-panel trigger: delay button — only meaningful on a flight leg;
// shifts projected arrival so detection.js can compare it against the next
// leg's departure.
export function delayFlight(tripId, flightId, minutes) {
  const node = requireNode(tripId, flightId);
  if (node.type !== 'FLIGHT') throw new Error(`Node ${flightId} is not a FLIGHT`);
  node.delayMinutes = minutes;
  node.projectedArrival = new Date(
    new Date(node.scheduledArrival).getTime() + minutes * 60_000
  ).toISOString();
  return node;
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
