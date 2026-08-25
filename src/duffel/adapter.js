// Duffel adapter — implements the same shape the provider port expects, so the
// agent core cannot tell it apart from the simulator.
//
// The executor calls bookFlight/cancelBooking and knows nothing about offers,
// passengers or two-step cancellations; all of that lives here.

import * as duffel from './client.js';
import { normalizeDuffelOffers, normalizeSeatMap } from '../normalize/duffelFlights.js';

// Test-mode passenger. Real member details would come from the account record;
// this is a sandbox that books nothing real, so a fixed identity is honest and
// keeps the demo reproducible.
// Verified live 2026-08-25: Duffel's `Idempotency-Key` header does NOT return
// the original order on a repeat POST /air/orders. It answers
// 422 offer_request_already_booked instead.
//
// That is a SAFE failure — no double charge — but it is the wrong shape for
// this agent. The executor reads a throw as "this candidate failed" and moves
// to the next one, so a retried network call would book a DIFFERENT flight
// rather than returning the booking that already exists. The project invariant
// is that a retry cannot cause a second booking, so the adapter enforces
// idempotency itself rather than trusting the vendor to.
//
// Process-local, like the simulator's map: it survives retries within a run,
// which is the window a network retry actually occupies.
const ordersByIdempotencyKey = new Map();

const ALREADY_BOOKED = new Set(['offer_request_already_booked', 'offer_no_longer_available']);

const TEST_PASSENGER = {
  title: 'mr',
  gender: 'm',
  given_name: 'Test',
  family_name: 'Member',
  born_on: '1990-01-01',
  email: 'test@example.com',
  phone_number: '+442080160509',
};

export async function searchFlights({ origin, destination, departuredate, cabinClass = 'economy' }) {
  const result = await duffel.createOfferRequest({
    origin, destination, departureDate: departuredate, cabinClass,
  });
  return normalizeDuffelOffers(result?.offers ?? []);
}

export async function getSeatMap(offerId) {
  return normalizeSeatMap(await duffel.getSeatMap(offerId));
}

/**
 * Books one option. Returns the shape the executor expects — crucially a
 * `status` it can check before releasing anything.
 */
export async function bookFlight({ tripId, option, idempotencyKey }) {
  const offerId = option?.offerId ?? option?.id;
  if (!offerId) throw new Error('option has no Duffel offer id; it did not come from a Duffel search');

  // Answer a retry from what we already bought, before touching the API.
  if (idempotencyKey && ordersByIdempotencyKey.has(idempotencyKey)) {
    return ordersByIdempotencyKey.get(idempotencyKey);
  }

  // Re-fetch the offer for its passenger id, and because a stale offer must
  // fail here rather than halfway through creating an order.
  const offer = await duffel.getOffer(offerId);
  const passengerId = offer?.passengers?.[0]?.id;
  if (!passengerId) throw new Error(`Duffel offer ${offerId} has no passenger to book`);

  let order;
  try {
    order = await duffel.createOrder({
      offerId,
      amount: offer.total_amount,
      currency: offer.total_currency,
      passengerId,
      passenger: TEST_PASSENGER,
      idempotencyKey,
    });
  } catch (err) {
    // Duffel telling us this offer request is already booked means the seat is
    // secured — surfacing that as a failure would send the executor off to buy
    // a second, different ticket. Return what we hold instead.
    if (ALREADY_BOOKED.has(err.duffelCode) && idempotencyKey && ordersByIdempotencyKey.has(idempotencyKey)) {
      return ordersByIdempotencyKey.get(idempotencyKey);
    }
    throw err;
  }

  const booking = {
    id: order.id,
    tripId,
    option,
    // Duffel returns a booking reference only once the order is real, so its
    // presence is what "confirmed" means here.
    status: order.booking_reference ? 'CONFIRMED' : 'PENDING',
    bookingReference: order.booking_reference ?? null,
    total: { amount: Number(order.total_amount), currency: order.total_currency },
    createdAt: order.created_at ?? new Date().toISOString(),
    provider: 'duffel',
  };

  if (idempotencyKey) ordersByIdempotencyKey.set(idempotencyKey, booking);
  return booking;
}

export function _resetIdempotencyForTests() {
  ordersByIdempotencyKey.clear();
}

/** Independent confirmation, so "confirm before release" can be verified. */
export async function getBooking(orderId) {
  const order = await duffel.getOrder(orderId);
  return {
    id: order.id,
    status: order.cancelled_at ? 'CANCELLED' : 'CONFIRMED',
    bookingReference: order.booking_reference ?? null,
    provider: 'duffel',
  };
}

export async function cancelBooking(orderId) {
  return duffel.cancelOrder(orderId);
}
