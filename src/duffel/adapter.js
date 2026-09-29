// Duffel adapter — implements the same shape the provider port expects, so the
// agent core cannot tell it apart from the simulator.
//
// The executor calls bookFlight/cancelBooking and knows nothing about offers,
// passengers or two-step cancellations; all of that lives here.

import * as duffel from './client.js';
import { config } from '../config.js';
import { normalizeDuffelOffers, normalizeSeatMap } from '../normalize/duffelFlights.js';

// Duffel's order idempotency header does not return the original order on a
// repeat POST. Cache in-flight promises, returned orders and ambiguous errors
// locally; metadata allows read-only reconciliation after a lost response.
// Durable recovery claims remain separate work before member-trip integration.
const ordersByIdempotencyKey = new Map();

const ALREADY_BOOKED = new Set(['offer_request_already_booked', 'offer_already_booked']);
const requestOptions = () => ({ signal: AbortSignal.timeout(30_000) });

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
  return normalizeDuffelOffers(result?.offers ?? [])
    .filter((offer) => !config.duffel.airwaysOnly || offer.airline === config.duffel.airlineCode);
}

export async function getSeatMap(offerId) {
  return normalizeSeatMap(await duffel.getSeatMap(offerId));
}

/** Refresh before policy is evaluated; bookFlight consumes this exact quote. */
export async function prepareFlight({ option }) {
  const offerId = option?.offerId ?? option?.id;
  if (!offerId) throw new Error('option has no Duffel offer id');
  const offer = await duffel.getOffer(offerId, requestOptions());
  const [refreshed] = normalizeDuffelOffers([offer]);
  if (offer.id !== offerId || !refreshed || offer.slices?.length !== 1
      || (config.duffel.airwaysOnly && refreshed.airline !== config.duffel.airlineCode)
      || offer.passengers?.length !== 1 || !offer.passengers[0].id
      || typeof offer.total_amount !== 'string' || !/^\d+(?:\.\d{1,4})?$/.test(offer.total_amount)
      || !/^[A-Z]{3}$/.test(offer.total_currency)
      || !Number.isFinite(Date.parse(offer.expires_at)) || Date.parse(offer.expires_at) <= Date.now()) {
    throw new Error('Duffel offer is expired or has no usable itinerary, passenger or fare');
  }
  return { option: refreshed, passengerId: offer.passengers[0].id,
    amount: offer.total_amount, currency: offer.total_currency, expiresAt: offer.expires_at };
}

function orderBooking(order, { tripId, option } = {}) {
  const [itinerary] = normalizeDuffelOffers([{ ...order, id: order.offer_id ?? option?.id }]);
  return {
    id: order.id, tripId,
    option: itinerary ?? option,
    status: order.cancelled_at ? 'CANCELLED'
      : order.booking_reference && order.payment_status?.awaiting_payment === false ? 'CONFIRMED' : 'PENDING',
    bookingReference: order.booking_reference ?? null,
    total: { amount: typeof order.total_amount === 'string' && /^\d+(?:\.\d{1,4})?$/.test(order.total_amount)
      ? Number(order.total_amount) : NaN, currency: order.total_currency },
    createdAt: order.created_at ?? new Date().toISOString(), provider: 'duffel',
  };
}

/** Cache in-flight and ambiguous results as well as completed orders. */
export async function bookFlight(request, { beforeBooking } = {}) {
  const { idempotencyKey } = request;
  if (!idempotencyKey) throw Object.assign(new Error('Booking requires an idempotency key'), { bookingOutcome: 'NOT_CREATED' });
  if (ordersByIdempotencyKey.has(idempotencyKey)) return ordersByIdempotencyKey.get(idempotencyKey);
  const operation = createBooking(request, beforeBooking);
  ordersByIdempotencyKey.set(idempotencyKey, operation);
  try { return await operation; }
  catch (error) {
    // Only a definitive rejection allows another attempt. A lost response is
    // retained so neither this key nor the executor's fallback can purchase again.
    if (error.bookingOutcome === 'NOT_CREATED') ordersByIdempotencyKey.delete(idempotencyKey);
    throw error;
  }
}

async function createBooking({ tripId, option, prepared, idempotencyKey }, beforeBooking) {
  let quote;
  try {
    beforeBooking?.();
    quote = prepared ?? await prepareFlight({ option });
    if (quote.option.id !== (option.offerId ?? option.id) || Date.parse(quote.expiresAt) <= Date.now()) {
      throw new Error('Prepared offer expired or does not match the selected flight');
    }
  } catch (error) {
    error.bookingOutcome = 'NOT_CREATED';
    throw error;
  }
  let order;
  try {
    order = await duffel.createOrder({
      offerId: quote.option.offerId, amount: quote.amount, currency: quote.currency,
      passengerId: quote.passengerId, passenger: TEST_PASSENGER, idempotencyKey,
      metadata: { tripshield_recovery_key: idempotencyKey },
    }, requestOptions());
  } catch (error) {
    error.bookingOutcome = [400, 401, 402, 403, 404, 410, 422].includes(error.status)
      && !ALREADY_BOOKED.has(error.duffelCode) ? 'NOT_CREATED' : 'UNKNOWN';
    throw error;
  }
  if (!order?.id) throw Object.assign(new Error('Order creation returned no identifier'), { bookingOutcome: 'UNKNOWN' });
  return orderBooking(order, { tripId, option: quote.option });
}

export function _resetIdempotencyForTests() {
  ordersByIdempotencyKey.clear();
}

/** Independent read: a reference alone does not establish that payment completed. */
export async function getBooking(orderId) {
  return orderBooking(await duffel.getOrder(orderId, requestOptions()));
}

export async function findRecoveryBooking({ option, idempotencyKey }) {
  const orders = await duffel.listOrdersForOffer(option.offerId ?? option.id, requestOptions());
  const matches = orders.filter(order => order.metadata?.tripshield_recovery_key === idempotencyKey);
  return matches.length === 1 ? orderBooking(matches[0]) : null;
}

export async function cancelBooking(orderId) {
  return duffel.cancelOrder(orderId);
}
