import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { getFlightQuote, createMemberOrder, findMemberOrder, trackMemberOrder } from '../src/duffel/member.js';

const oldToken = config.duffel.accessToken;
const oldOverride = process.env.DUFFEL_ALLOW_LIVE;
beforeEach(() => { config.duffel.accessToken = 'duffel_test_offline'; });
afterEach(() => {
  config.duffel.accessToken = oldToken;
  if (oldOverride === undefined) delete process.env.DUFFEL_ALLOW_LIVE;
  else process.env.DUFFEL_ALLOW_LIVE = oldOverride;
  mock.restoreAll();
});
function rawOffer(changes = {}) {
  return { id: 'off_test001', live_mode: false, total_amount: '210.00', total_currency: 'EUR',
    expires_at: '2030-01-01T10:00:00Z', passengers: [{ id: 'pas_test', type: 'adult' }],
    passenger_identity_documents_required: false,
    slices: [{ duration: 'PT6H', segments: [{ marketing_carrier: { iata_code: 'ZZ' }, marketing_carrier_flight_number: '123',
      origin: { iata_code: 'JFK', time_zone: 'America/New_York' }, destination: { iata_code: 'LAX', time_zone: 'America/Los_Angeles' },
      departing_at: '2030-01-02T10:00:00', arriving_at: '2030-01-02T13:00:00', duration: 'PT6H',
      passengers: [{ cabin_class: 'economy' }] }] }], ...changes };
}
function stub(data) { mock.method(globalThis, 'fetch', async () => Response.json({ data })); }

test('quote comes from Duffel and preserves its exact payment amount and expiry', async () => {
  stub(rawOffer());
  const quote = await getFlightQuote('off_test001');
  assert.equal(quote.flight.source, 'duffel');
  assert.equal(quote.passengerId, 'pas_test');
  assert.deepEqual(quote.total, { amount: '210.00', currency: 'EUR' });
  assert.equal(quote.expiresAt, '2030-01-01T10:00:00Z');
});

for (const [label, changes, code] of [
  ['expired', { expires_at: '2000-01-01T00:00:00Z' }, 'OFFER_EXPIRED'],
  ['live offer', { live_mode: true }, 'SANDBOX_ONLY'],
  ['unknown mode', { live_mode: undefined }, 'SANDBOX_ONLY'],
  ['multiple passengers', { passengers: [{ id: 'one', type: 'adult' }, { id: 'two', type: 'adult' }] }, 'UNSUPPORTED_OFFER'],
]) {
  test(`${label} cannot enter member checkout`, async () => {
    stub(rawOffer(changes));
    await assert.rejects(getFlightQuote('off_test001'), error => error.code === code);
  });
}

test('member checkout refuses live tokens even with the legacy live override', async () => {
  config.duffel.accessToken = 'duffel_live_fake';
  process.env.DUFFEL_ALLOW_LIVE = 'yes-i-understand';
  mock.method(globalThis, 'fetch', () => assert.fail('live call must not happen'));
  await assert.rejects(getFlightQuote('off_test001'), error => error.code === 'SANDBOX_UNAVAILABLE');
});

test('order request uses server quote, passenger data, unique metadata, and sandbox balance', async () => {
  stub(rawOffer());
  const quote = await getFlightQuote('off_test001');
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async (url, request) => {
    assert.equal(new URL(url).pathname, '/air/orders');
    assert.equal(request.headers['Idempotency-Key'], 'booking-123');
    const { data } = JSON.parse(request.body);
    assert.deepEqual(data.payments, [{ type: 'balance', amount: '210.00', currency: 'EUR' }]);
    assert.deepEqual(data.selected_offers, ['off_test001']);
    assert.deepEqual(data.metadata, { tripshield_booking_id: 'booking-123' });
    assert.equal(data.passengers[0].given_name, 'Traveller');
    assert.equal(data.passengers[0].id, 'pas_test');
    return Response.json({ data: { id: 'ord_test001' } });
  });
  assert.equal((await createMemberOrder({ quote, passenger: { given_name: 'Traveller' }, idempotencyKey: 'booking-123' })).id, 'ord_test001');
});

test('independent confirmation requires matching metadata, a reference, and completed payment', async () => {
  const order = { id: 'ord_test001', live_mode: false, booking_reference: 'TEST01',
    payment_status: { awaiting_payment: false }, metadata: { tripshield_booking_id: 'booking-123' }, total_amount: '210.00', total_currency: 'EUR' };
  for (const [change, expected] of [[{}, 'CONFIRMED'], [{ payment_status: { awaiting_payment: true } }, 'PENDING'],
    [{ booking_reference: null }, 'PENDING'], [{ payment_status: undefined }, 'PENDING'], [{ cancelled_at: '2030-01-01' }, 'CANCELLED']]) {
    stub({ ...order, ...change });
    assert.equal((await findMemberOrder({ orderId: order.id, id: 'booking-123' })).status, expected);
    mock.restoreAll();
  }
  stub({ ...order, metadata: { tripshield_booking_id: 'someone-else' } });
  assert.equal(await findMemberOrder({ orderId: order.id, id: 'booking-123' }), null);
});

test('lost response lookup filters by offer and never adopts another member’s order', async () => {
  mock.method(globalThis, 'fetch', async url => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, '/air/orders');
    assert.equal(parsed.searchParams.get('offer_id'), 'off_test001');
    return Response.json({ data: [
      { id: 'ord_wrong', live_mode: false, metadata: { tripshield_booking_id: 'different-booking' } },
      { id: 'ord_right', live_mode: false, metadata: { tripshield_booking_id: 'booking-123' },
        booking_reference: 'FOUND1', payment_status: { awaiting_payment: false } },
    ] });
  });
  assert.equal((await findMemberOrder({ offerId: 'off_test001', id: 'booking-123' })).orderId, 'ord_right');
});

test('tracking calls Duffel order and airline changes APIs and reports changes without invented flight status', async () => {
  const paths = [];
  const segment = rawOffer().slices[0].segments[0];
  mock.method(globalThis, 'fetch', async url => {
    const parsed = new URL(url);
    paths.push(parsed.pathname);
    if (parsed.pathname === '/air/orders/ord_test001') return Response.json({ data: {
      ...rawOffer(), id: 'ord_test001', offer_id: 'off_test001', booking_reference: 'TEST01',
      metadata: { tripshield_booking_id: 'booking-123' }, payment_status: { awaiting_payment: false },
      synced_at: '2030-01-01T09:00:00Z',
    } });
    assert.equal(parsed.searchParams.get('order_id'), 'ord_test001');
    return Response.json({ data: [{ id: 'aic_test001', order_id: 'ord_test001', action_taken: null,
      created_at: '2030-01-01T09:00:00Z', removed: [{ segments: [segment] }],
      added: [{ segments: [{ ...segment, departing_at: '2030-01-02T12:00:00' }] }],
    }] });
  });
  const status = await trackMemberOrder({ orderId: 'ord_test001', id: 'booking-123' });
  assert.deepEqual(paths, ['/air/orders/ord_test001', '/air/airline_initiated_changes']);
  assert.equal(status.source, 'duffel');
  assert.equal(status.bookingStatus, 'CONFIRMED');
  assert.equal(status.changes[0].updated[0].departureTime, '2030-01-02T12:00:00');
  assert.equal(status.changes[0].actionTaken, null);
  assert.equal(status.mock, undefined);
  assert.equal(status.status, undefined, 'order confirmation does not establish on-time status');
});

test('tracking cannot read changes for an order with another booking identity', async () => {
  let calls = 0;
  mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ data: { live_mode: false, metadata: { tripshield_booking_id: 'someone-else' } } });
  });
  await assert.rejects(trackMemberOrder({ orderId: 'ord_test001', id: 'booking-123' }), error => error.code === 'ORDER_MISMATCH');
  assert.equal(calls, 1);
});
