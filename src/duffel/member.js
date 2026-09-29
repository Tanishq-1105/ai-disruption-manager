import { config } from '../config.js';
import * as duffel from './client.js';
import { normalizeDuffelOffers } from '../normalize/duffelFlights.js';
import { BookingError } from '../bookings/errors.js';

// Member checkout is sandbox-only, even if an operator enabled live mode for
// another adapter. The server owns all offer, payment, and passenger IDs.
function sandbox() {
  if (!config.duffel.accessToken?.startsWith('duffel_test_')) {
    throw new BookingError(503, 'SANDBOX_UNAVAILABLE', 'Duffel sandbox booking is not configured.');
  }
  return { signal: AbortSignal.timeout(30_000) };
}

export async function getFlightQuote(offerId) {
  const offer = await duffel.getOffer(offerId, sandbox());
  if (offer.live_mode !== false) {
    throw new BookingError(409, 'SANDBOX_ONLY', 'Only Duffel test offers can be booked here.');
  }
  if (offer.id !== offerId || offer.slices?.length !== 1 || offer.passengers?.length !== 1
      || offer.passengers[0].type !== 'adult' || !offer.passengers[0].id) {
    throw new BookingError(422, 'UNSUPPORTED_OFFER', 'Choose a one-way flight for one adult.');
  }
  const [flight] = normalizeDuffelOffers([offer]);
  if (!flight || !/^\d+(?:\.\d{1,4})?$/.test(offer.total_amount)
      || !/^[A-Z]{3}$/.test(offer.total_currency)
      || (config.duffel.airwaysOnly && flight.airline !== config.duffel.airlineCode)) {
    throw new BookingError(422, 'INVALID_OFFER', 'This flight has no usable itinerary or fare.');
  }
  if (!Number.isFinite(Date.parse(offer.expires_at)) || Date.parse(offer.expires_at) <= Date.now()) {
    throw new BookingError(410, 'OFFER_EXPIRED', 'This offer expired. Search again for a fresh flight.');
  }
  return {
    offerId, flight, total: { amount: offer.total_amount, currency: offer.total_currency },
    expiresAt: offer.expires_at, passengerId: offer.passengers[0].id,
    requiresPassport: offer.passenger_identity_documents_required === true,
  };
}

export async function createMemberOrder({ quote, passenger, idempotencyKey }) {
  const order = await duffel.createOrder({
    offerId: quote.offerId, amount: quote.total.amount, currency: quote.total.currency,
    passengerId: quote.passengerId, passenger, idempotencyKey,
    metadata: { tripshield_booking_id: idempotencyKey },
  }, sandbox());
  if (!order?.id) throw new Error('No order identifier returned');
  return { id: order.id };
}

export async function findMemberOrder({ orderId, offerId, id }) {
  const options = sandbox();
  // A lost POST response can be reconciled by its server-generated metadata;
  // it must never cause a second POST or a fallback to another flight.
  const orders = orderId
    ? [await duffel.getOrder(orderId, options)]
    : await duffel.listOrdersForOffer(offerId, options);
  const matches = orders.filter(order => order.metadata?.tripshield_booking_id === id);
  if (matches.length !== 1 || matches[0].live_mode !== false) return null;
  const order = matches[0];
  return {
    orderId: order.id,
    bookingReference: order.booking_reference ?? null,
    status: order.cancelled_at ? 'CANCELLED'
      : order.booking_reference && order.payment_status?.awaiting_payment === false ? 'CONFIRMED' : 'PENDING',
    total: { amount: order.total_amount, currency: order.total_currency },
  };
}

function changeSegments(slices = []) {
  return slices.flatMap(slice => (slice.segments ?? []).map(segment => ({
    flightNumber: `${segment.marketing_carrier?.iata_code ?? ''}${segment.marketing_carrier_flight_number ?? ''}`,
    origin: segment.origin?.iata_code, destination: segment.destination?.iata_code,
    departureTime: segment.departing_at, arrivalTime: segment.arriving_at,
  })));
}

export async function trackMemberOrder({ orderId, id }) {
  const order = await duffel.getOrder(orderId, sandbox());
  if (order.live_mode !== false || order.metadata?.tripshield_booking_id !== id) {
    throw new BookingError(409, 'ORDER_MISMATCH', 'This order could not be verified for your trip.');
  }
  const changes = await duffel.listAirlineChanges(orderId, sandbox());
  const [flight] = normalizeDuffelOffers([{ ...order, id: order.offer_id, expires_at: null }]);
  return {
    source: 'duffel', sandbox: true, checkedAt: new Date().toISOString(), syncedAt: order.synced_at ?? null,
    bookingReference: order.booking_reference ?? null,
    bookingStatus: order.cancelled_at ? 'CANCELLED'
      : order.booking_reference && order.payment_status?.awaiting_payment === false ? 'CONFIRMED' : 'PENDING',
    flight: flight ?? null,
    changes: changes.filter(change => change.order_id === orderId).map(change => ({
      id: change.id, createdAt: change.created_at, actionTaken: change.action_taken ?? null,
      previous: changeSegments(change.removed), updated: changeSegments(change.added),
    })),
  };
}
