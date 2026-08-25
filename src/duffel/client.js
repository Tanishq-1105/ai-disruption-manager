import { config } from '../config.js';

// Raw Duffel REST calls. Verified live on 2026-08-25 against a duffel_test_
// token: 27 offers for JFK-LAX, a 192-seat seat map, order creation, retrieval,
// and cancellation with refund confirmation all succeeded.
//
// Duffel fills the three gaps this Sabre account cannot: a real seat map, a
// bookable order, and a release path — which means the Phase 6
// "confirm new before releasing old" rule can be exercised against a real API
// rather than only the simulator.

const API_VERSION = 'v2';

// A live token books real flights and moves real money. Nothing in this project
// is ready for that, so the client refuses anything but a test token unless the
// operator very explicitly opts in.
export function assertSafeToken(token = config.duffel.accessToken) {
  if (!token) throw new Error('DUFFEL_ACCESS_TOKEN is not set');
  if (token.startsWith('duffel_test_')) return token;
  if (process.env.DUFFEL_ALLOW_LIVE === 'yes-i-understand') return token;
  throw new Error(
    'Refusing a non-test Duffel token. This project books automatically; a live '
    + 'token would create real tickets. Use a duffel_test_ token.',
  );
}

function headers({ idempotencyKey } = {}) {
  return {
    Authorization: `Bearer ${assertSafeToken()}`,
    'Duffel-Version': API_VERSION,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    // Duffel deduplicates on this header, which lines up exactly with the
    // executor's per-attempt key: a retry returns the original order rather
    // than buying a second seat.
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  };
}

async function request(path, { method = 'GET', body, idempotencyKey, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${config.duffel.baseUrl}${path}`, {
    method,
    headers: headers({ idempotencyKey }),
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await res.text();
  const data = raw ? JSON.parse(raw) : null;

  if (!res.ok) {
    // Duffel returns a structured errors array; surface the first message so a
    // failed booking says something useful in the audit trail.
    const first = data?.errors?.[0];
    const detail = first ? `${first.title}: ${first.message}` : JSON.stringify(data);
    const error = new Error(`Duffel ${method} ${path} -> ${res.status} ${detail}`);
    error.status = res.status;
    error.duffelCode = first?.code ?? null;
    throw error;
  }
  return data?.data ?? data;
}

/** Search. `return_offers=true` avoids a second round trip for the offer list. */
export function createOfferRequest({ origin, destination, departureDate, cabinClass = 'economy', passengers = [{ type: 'adult' }] }, opts) {
  return request('/air/offer_requests?return_offers=true', {
    method: 'POST',
    body: {
      data: {
        slices: [{ origin, destination, departure_date: departureDate }],
        passengers,
        cabin_class: cabinClass,
      },
    },
    ...opts,
  });
}

export function getOffer(offerId, opts) {
  return request(`/air/offers/${offerId}?return_available_services=true`, opts);
}

/**
 * The real seat matrix. Returns [] rather than throwing when an offer has no
 * map — partner-airline offers in test mode often do not, while Duffel Airways
 * offers do, and an absent map is not an error.
 */
export async function getSeatMap(offerId, opts) {
  try {
    return (await request(`/air/seat_maps?offer_id=${offerId}`, opts)) ?? [];
  } catch (err) {
    if (err.status === 404) return [];
    throw err;
  }
}

export function createOrder({ offerId, amount, currency, passengerId, passenger, idempotencyKey }, opts) {
  return request('/air/orders', {
    method: 'POST',
    idempotencyKey,
    body: {
      data: {
        type: 'instant',
        selected_offers: [offerId],
        // Test-mode balance payment: no card, no real money.
        payments: [{ type: 'balance', amount, currency }],
        passengers: [{ id: passengerId, ...passenger }],
      },
    },
    ...opts,
  });
}

export function getOrder(orderId, opts) {
  return request(`/air/orders/${orderId}`, opts);
}

/**
 * Release is two steps in Duffel: request a cancellation quote, then confirm
 * it. Both must succeed for the ticket to actually be gone, so the caller only
 * treats it as released when the confirm returns.
 */
export async function cancelOrder(orderId, opts) {
  const cancellation = await request('/air/order_cancellations', {
    method: 'POST',
    body: { data: { order_id: orderId } },
    ...opts,
  });
  const confirmed = await request(
    `/air/order_cancellations/${cancellation.id}/actions/confirm`,
    { method: 'POST', ...opts },
  );
  return {
    id: confirmed.id ?? cancellation.id,
    orderId,
    refundAmount: cancellation.refund_amount ?? null,
    refundCurrency: cancellation.refund_currency ?? null,
    status: 'CANCELLED',
  };
}
