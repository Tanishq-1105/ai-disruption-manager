import { randomUUID } from 'node:crypto';
import { toUtcMinutes } from '../normalize/plausibility.js';
import { HttpError } from '../errors.js';

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
  if (!trip) throw new HttpError(404, 'TRIP_NOT_FOUND', `Unknown trip ${tripId}`);
  return trip;
}

function requireNode(tripId, nodeId) {
  const node = requireTrip(tripId).nodes.find((n) => n.id === nodeId);
  if (!node) throw new HttpError(404, 'NODE_NOT_FOUND', `Unknown node ${nodeId} on trip ${tripId}`);
  return node;
}

export function seedTrip(tripId, nodes) {
  if (!Array.isArray(nodes) || nodes.some(node => !node || typeof node.id !== 'string' || !node.type)) {
    throw new HttpError(400, 'INVALID_NODES', 'nodes must be an array of nodes with id and type');
  }
  // Seeding is a fresh start for this trip, so clear any bookings and
  // idempotency keys it left behind. Without this a second demo run reuses the
  // first run's keys, bookFlight short-circuits to the cached booking, and the
  // armed failure never fires — correct idempotency, wrong demo semantics.
  for (const [bookingId, booking] of bookings) {
    if (booking.tripId !== tripId) continue;
    bookings.delete(bookingId);
    for (const [key, mappedId] of idempotencyResults) {
      if (mappedId === bookingId) idempotencyResults.delete(key);
    }
  }

  trips.set(tripId, {
    id: tripId,
    nodes: nodes.map((n) => ({ status: 'CONFIRMED', dependsOn: [], ...n })),
  });

  // A node that declares a bookingId already has a ticket in the real world,
  // so register it here too. Without this the executor has nothing to release
  // and the "confirm new before releasing old" ordering cannot be demonstrated.
  for (const node of trips.get(tripId).nodes) {
    if (!node.bookingId || bookings.has(node.bookingId)) continue;
    bookings.set(node.bookingId, {
      id: node.bookingId,
      tripId,
      nodeId: node.id,
      option: { flightNumber: node.id, origin: node.origin, destination: node.destination, price: node.price },
      status: 'CONFIRMED',
      createdAt: new Date().toISOString(),
      preExisting: true,
    });
  }

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
  if (node.type !== 'FLIGHT') throw new HttpError(400, 'INVALID_FLIGHT', `Node ${flightId} is not a FLIGHT`);
  if (!Number.isFinite(minutes) || minutes < 0) throw new HttpError(400, 'INVALID_DELAY', 'minutes must be a non-negative number');
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

// Shared through the provider port so the same control works with Duffel.
// Adapters call this after returning any cached idempotency result.
export function failBookingIfArmed() {
  if (forceNextBookingFailure) {
    forceNextBookingFailure = false;
    throw Object.assign(new Error('Simulated booking failure'), { bookingOutcome: 'NOT_CREATED' });
  }
}

// Every mutating booking request carries an idempotency key so a network
// retry can never cause a double booking.
export function bookFlight({ tripId, option, idempotencyKey }) {
  if (idempotencyResults.has(idempotencyKey)) {
    return bookings.get(idempotencyResults.get(idempotencyKey));
  }

  failBookingIfArmed();

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

// Applies a downstream adjustment the policy engine authorised — shifting a
// hotel, retiming a car. Simulated like every other action: real hotel and
// ground APIs are not available behind this account.
export function adjustNode({ tripId, nodeId, action }) {
  const node = requireNode(tripId, nodeId);
  node.status = 'ADJUSTED';
  node.adjustment = { action, at: new Date().toISOString() };
  return node;
}

// Keep the graph pointed at the ticket the member now holds. Old delay fields
// describe the replaced flight and must not affect its replacement's links.
export function replaceFlight({ tripId, nodeId, booking }) {
  const node = requireNode(tripId, nodeId);
  if (node.type !== 'FLIGHT') throw new Error(`Node ${nodeId} is not a FLIGHT`);
  if (!booking?.id || booking.status !== 'CONFIRMED' || !booking.option) {
    throw new Error('A confirmed replacement booking is required');
  }

  const option = booking.option;
  const departure = toUtcMinutes(
    option.departureTime, option.segments?.[0]?.departureOffsetHours ?? option.departureOffsetHours,
  );
  const arrival = toUtcMinutes(
    option.arrivalTime, option.segments?.at(-1)?.arrivalOffsetHours ?? option.arrivalOffsetHours,
  );
  if (departure === null || arrival === null) {
    throw new Error('Replacement flight has unusable schedule times');
  }

  Object.assign(node, {
    status: 'CONFIRMED',
    bookingId: booking.id,
    bookingReference: booking.bookingReference ?? null,
    origin: option.origin,
    destination: option.destination,
    airline: option.airline,
    flightNumber: option.flightNumber,
    cabin: option.cabin,
    price: structuredClone(booking.total ?? option.price),
    stops: option.stops,
    durationMinutes: option.durationMinutes,
    segments: structuredClone(option.segments ?? []),
    scheduledDeparture: new Date(departure * 60_000).toISOString(),
    scheduledArrival: new Date(arrival * 60_000).toISOString(),
  });
  delete node.delayMinutes;
  delete node.projectedArrival;
  delete node.projectedDeparture;
  bookings.set(booking.id, { ...booking, tripId, nodeId });
  return node;
}

export function cancelBooking(bookingId) {
  const booking = bookings.get(bookingId);
  if (!booking) throw new Error(`Unknown booking ${bookingId}`);
  booking.status = 'CANCELLED';
  return booking;
}

export function getBooking(bookingId) {
  const booking = bookings.get(bookingId);
  if (!booking) throw new Error(`Unknown booking ${bookingId}`);
  return structuredClone({ ...booking, total: booking.total ?? booking.option?.price });
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
