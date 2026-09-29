import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createProvider } from '../src/providers/index.js';
import * as simulator from '../src/simulator/state.js';
import { _resetIdempotencyForTests } from '../src/duffel/adapter.js';
import { config } from '../src/config.js';
import { runRecovery } from '../src/agent/recovery.js';

const previousToken = config.duffel.accessToken;
beforeEach(() => {
  simulator._resetForTests();
  _resetIdempotencyForTests();
  config.duffel.accessToken = 'duffel_test_offline_regression';
});
afterEach(() => {
  mock.restoreAll();
  config.duffel.accessToken = previousToken;
});

function option(id, hour = 12) {
  return {
    id,
    offerId: id,
    airline: 'ZZ',
    flightNumber: `ZZ-${id}`,
    cabin: 'ECONOMY',
    origin: 'JFK',
    destination: 'LAX',
    departureTime: `2026-10-12T${hour}:00:00Z`,
    arrivalTime: `2026-10-12T${hour + 6}:00:00Z`,
    durationMinutes: 360,
    stops: 0,
    price: { amount: 210, currency: 'USD' },
  };
}

function seedCancelledTrip(provider, tripId = 'trip-1') {
  return provider.seedTrip(tripId, [{
    id: 'flight', type: 'FLIGHT', status: 'CANCELLED',
    bookingId: `${tripId}-old`, airline: 'ZZ', cabin: 'ECONOMY',
    origin: 'JFK', destination: 'LAX',
    scheduledDeparture: '2026-10-12T11:00:00Z',
    scheduledArrival: '2026-10-12T17:00:00Z',
    projectedArrival: '2026-10-12T20:00:00Z', delayMinutes: 180,
    price: { amount: 200, currency: 'USD' },
    refundable: true, reversible: true, dependsOn: ['inbound'],
  }]);
}

// Exercise the actual provider port and Duffel adapter without external calls.
// A fresh order ID on every POST makes accidental repeat purchases observable.
function stubDuffel({ refresh = offer => offer, confirm = order => order, afterCreate } = {}) {
  const calls = [];
  const offers = new Map();
  const orders = new Map();
  mock.method(globalThis, 'fetch', async (url, request) => {
    const path = new URL(url).pathname;
    const body = request.body && JSON.parse(request.body).data;
    const method = request.method;
    calls.push({ path, body, method });
    if (path.startsWith('/air/offers/')) {
      const id = path.split('/').at(-1);
      const hour = id === 'b' ? 13 : 12;
      const offer = refresh({
        id, live_mode: false, total_amount: '210.00', total_currency: 'USD',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        passengers: [{ id: 'pas_test', type: 'adult' }],
        slices: [{ duration: 'PT6H', segments: [{
          marketing_carrier: { iata_code: 'ZZ' }, marketing_carrier_flight_number: `-${id}`,
          origin: { iata_code: 'JFK', time_zone: 'Etc/UTC' }, destination: { iata_code: 'LAX', time_zone: 'Etc/UTC' },
          departing_at: `2026-10-12T${hour}:00:00`, arriving_at: `2026-10-12T${hour + 6}:00:00`,
          duration: 'PT6H', passengers: [{ cabin_class: 'economy' }],
        }] }],
      });
      offers.set(id, offer);
      return Response.json({ data: offer });
    }
    if (path.startsWith('/air/orders/')) return Response.json({ data: confirm(orders.get(path.split('/').at(-1))) });
    assert.equal(path, '/air/orders', 'unexpected external request');
    if (method === 'GET') return Response.json({ data: [...orders.values()] });
    const offer = offers.get(body.selected_offers[0]);
    const order = { ...offer, id: `ord_test_${orders.size + 1}`, offer_id: offer.id,
      metadata: body.metadata, payment_status: { awaiting_payment: false }, booking_reference: 'TESTREF' };
    orders.set(order.id, order);
    if (afterCreate) await afterCreate(order);
    return Response.json({ data: order });
  });
  return calls;
}

for (const bookingProvider of ['simulator', 'duffel']) {
  test(`${bookingProvider}: forced failure happens once, then recovery falls back`, async () => {
    const calls = stubDuffel();
    const provider = createProvider({ bookingProvider });
    seedCancelledTrip(provider);
    provider.setForceNextBookingFailure(true);
    const result = await runRecovery({
      tripId: 'trip-1', provider,
      searchReplacements: async () => [option('a'), option('b', 13)],
    });

    const { execution } = result.recoveries[0];
    assert.equal(execution.status, 'RECOVERED');
    assert.deepEqual(execution.attempts.map(a => a.outcome), ['BOOKING_FAILED', 'BOOKED']);
    assert.match(execution.attempts[0].detail, /Simulated booking failure/);
    const failure = result.audit.find(a => a.outcome === 'BOOKING_FAILED');
    assert.equal(failure.oldTicketRetained, true);
    const bookedIndex = result.audit.findIndex(a => a.outcome === 'BOOKED');
    const releasedIndex = result.audit.findIndex(a => a.outcome === 'OLD_RELEASED');
    assert.ok(bookedIndex >= 0 && releasedIndex > bookedIndex);
    assert.equal(provider.getState().bookings.find(b => b.id === 'trip-1-old').status, 'CANCELLED');
    if (bookingProvider === 'duffel') {
      assert.deepEqual(calls.map(c => c.path), ['/air/offers/a', '/air/offers/b', '/air/orders', '/air/orders/ord_test_1']);
      assert.deepEqual(calls.find(c => c.method === 'POST').body.selected_offers, ['b']);
    } else {
      assert.equal(calls.length, 0);
    }
  });

  test(`${bookingProvider}: cached booking retries do not consume an armed failure`, async () => {
    stubDuffel();
    const provider = createProvider({ bookingProvider });
    const request = { tripId: 'trip-1', option: option('a'), idempotencyKey: 'already-booked' };
    const first = await provider.bookFlight(request);
    provider.setForceNextBookingFailure(true);
    assert.equal((await provider.bookFlight(request)).id, first.id);
    await assert.rejects(async () => provider.bookFlight({
      ...request, option: option('b'), idempotencyKey: 'next-booking',
    }), /Simulated booking failure/);
    assert.equal((await provider.bookFlight({
      ...request, option: option('b'), idempotencyKey: 'next-booking',
    })).status, 'CONFIRMED');
  });
}

test('successful recovery stores the replacement and repeat recovery does not search or book', async () => {
  const calls = stubDuffel();
  const provider = createProvider({ bookingProvider: 'duffel' });
  seedCancelledTrip(provider);
  let searches = 0;
  const args = {
    tripId: 'trip-1', provider,
    searchReplacements: async () => [option(`fresh-offer-${++searches}`)],
  };
  const first = await runRecovery(args);
  const execution = first.recoveries[0].execution;
  const node = provider.getTrip('trip-1').nodes[0];
  assert.equal(node.status, 'CONFIRMED');
  assert.equal(node.bookingId, execution.bookingId);
  assert.equal(node.flightNumber, execution.option.flightNumber);
  assert.equal(node.scheduledDeparture, '2026-10-12T12:00:00.000Z');
  assert.equal(node.scheduledArrival, '2026-10-12T18:00:00.000Z');
  assert.equal(node.projectedArrival, undefined);
  assert.equal(node.delayMinutes, undefined);
  assert.deepEqual(node.price, { amount: 210, currency: 'USD' });
  assert.deepEqual(node.dependsOn, ['inbound']);
  assert.ok(provider.getState().bookings.some(b => b.id === execution.bookingId && b.nodeId === 'flight'));
  const update = first.audit.find(a => a.action === 'UPDATE_FLIGHT');
  assert.equal(update.bookingId, execution.bookingId);
  assert.equal(update.authorisedBy, 'WITHIN_LIMITS');

  const second = await runRecovery(args);
  assert.deepEqual(second.recoveries, []);
  assert.equal(searches, 1, 'a fresh search would create fresh offer IDs and bypass booking-key caches');
  assert.equal(calls.filter(c => c.path === '/air/orders' && c.method === 'POST').length, 1);
});

test('recovered schedule uses segment timezone offsets and stores the actual fallback itinerary', async () => {
  const provider = createProvider({ bookingProvider: 'simulator' });
  seedCancelledTrip(provider);
  provider.setForceNextBookingFailure(true);
  const replacement = {
    ...option('fallback', 13),
    departureTime: '2026-10-12T12:00:00', arrivalTime: '2026-10-12T15:00:00',
    segments: [{ departureOffsetHours: -4, arrivalOffsetHours: -7 }],
  };
  const result = await runRecovery({
    tripId: 'trip-1', provider, searchReplacements: async () => [option('first'), replacement],
  });
  const node = provider.getTrip('trip-1').nodes[0];
  assert.equal(result.recoveries[0].execution.option.id, 'fallback');
  assert.equal(node.flightNumber, replacement.flightNumber);
  assert.equal(node.scheduledDeparture, '2026-10-12T16:00:00.000Z');
  assert.equal(node.scheduledArrival, '2026-10-12T22:00:00.000Z');
  assert.deepEqual(node.segments, replacement.segments);
});

for (const kind of ['failed', 'pending', 'unauthorised']) {
  test(`${kind} recovery leaves the cancelled flight and its old booking intact`, async () => {
    const provider = createProvider({ bookingProvider: 'simulator' });
    seedCancelledTrip(provider);
    const original = structuredClone(provider.getTrip('trip-1').nodes[0]);
    provider.bookFlight = async () => {
      if (kind === 'failed') throw Object.assign(new Error('supplier unavailable'), { bookingOutcome: 'NOT_CREATED' });
      if (kind === 'pending') return { id: 'pending-booking', status: 'PENDING' };
      assert.fail('unauthorised booking must not be attempted');
    };
    const result = await runRecovery({
      tripId: 'trip-1', provider,
      searchReplacements: async () => kind === 'unauthorised' ? [] : [option('a')],
    });
    assert.deepEqual(provider.getTrip('trip-1').nodes[0], original);
    assert.equal(provider.getState().bookings.find(b => b.id === 'trip-1-old').status, 'CONFIRMED');
    assert.equal(result.audit.some(a => a.action === 'UPDATE_FLIGHT'), false);
  });
}

test('release failure still attaches the confirmed replacement and does not repurchase it', async () => {
  const provider = createProvider({ bookingProvider: 'simulator' });
  seedCancelledTrip(provider);
  provider.cancelBooking = async () => { throw new Error('release refused'); };
  let searches = 0;
  const args = { tripId: 'trip-1', provider, searchReplacements: async () => [option(`a-${++searches}`)] };
  const result = await runRecovery(args);
  const execution = result.recoveries[0].execution;
  assert.equal(execution.status, 'RECOVERED_NEEDS_ATTENTION');
  assert.equal(provider.getTrip('trip-1').nodes[0].bookingId, execution.bookingId);
  assert.equal(provider.getState().bookings.find(b => b.id === 'trip-1-old').status, 'CONFIRMED');
  await runRecovery(args);
  assert.equal(searches, 1);
});

test('overlapping recovery requests for one trip cause one search, booking, and action audit', async () => {
  const calls = stubDuffel();
  const provider = createProvider({ bookingProvider: 'duffel' });
  seedCancelledTrip(provider);
  let searches = 0;
  let releaseSearch;
  const pendingSearch = new Promise(resolve => { releaseSearch = resolve; });
  const args = {
    tripId: 'trip-1', provider,
    searchReplacements: async () => {
      const id = `concurrent-${++searches}`;
      await pendingSearch;
      return [option(id)];
    },
  };
  const first = runRecovery(args);
  const second = runRecovery(args);
  releaseSearch();
  const results = await Promise.all([first, second]);
  assert.equal(searches, 1);
  assert.equal(calls.filter(c => c.path === '/air/orders' && c.method === 'POST').length, 1);
  assert.equal(results[0].recoveries[0].execution.status, 'RECOVERED');
  assert.deepEqual(results[1].recoveries, []);
  assert.deepEqual(results[1].audit, []);
});

test('a failed recovery request does not block a later recovery of the trip', async () => {
  const provider = createProvider({ bookingProvider: 'simulator' });
  seedCancelledTrip(provider);
  await assert.rejects(runRecovery({
    tripId: 'trip-1', provider, searchReplacements: async () => { throw new Error('search offline'); },
  }), /search offline/);
  const result = await runRecovery({
    tripId: 'trip-1', provider, searchReplacements: async () => [option('a')],
  });
  assert.equal(result.recoveries[0].execution.status, 'RECOVERED');
});

test('different trips can recover independently', async () => {
  const provider = createProvider({ bookingProvider: 'simulator' });
  seedCancelledTrip(provider, 'one');
  seedCancelledTrip(provider, 'two');
  const results = await Promise.all(['one', 'two'].map(tripId => runRecovery({
    tripId, provider, searchReplacements: async () => [option(tripId)],
  })));
  assert.equal(results.every(r => r.recoveries[0].execution.status === 'RECOVERED'), true);
  assert.notEqual(provider.getTrip('one').nodes[0].bookingId, provider.getTrip('two').nodes[0].bookingId);
});

for (const price of [{ total_amount: '9000.00', total_currency: 'USD' }, { total_amount: '210.00', total_currency: 'EUR' }]) {
  test(`Duffel refreshed ${price.total_amount} ${price.total_currency} cannot bypass recovery policy`, async () => {
    const calls = stubDuffel({ refresh: offer => ({ ...offer, ...price }) });
    const provider = createProvider({ bookingProvider: 'duffel' });
    seedCancelledTrip(provider);
    const result = await runRecovery({ tripId: 'trip-1', provider, searchReplacements: async () => [option('a')] });
    assert.equal(result.recoveries[0].execution.status, 'EXHAUSTED');
    assert.equal(calls.some(call => call.method === 'POST'), false);
    assert.equal(provider.getState().bookings.find(b => b.id === 'trip-1-old').status, 'CONFIRMED');
  });
}

test('Duffel refresh within policy is paid exactly and is reflected in the node and message', async () => {
  const calls = stubDuffel({ refresh: offer => ({ ...offer, total_amount: '250.25' }) });
  const provider = createProvider({ bookingProvider: 'duffel' });
  seedCancelledTrip(provider);
  const result = await runRecovery({ tripId: 'trip-1', provider, searchReplacements: async () => [option('a')] });
  assert.equal(result.recoveries[0].execution.status, 'RECOVERED');
  assert.equal(calls.find(call => call.method === 'POST').body.payments[0].amount, '250.25');
  assert.equal(calls.filter(call => call.path.startsWith('/air/offers/')).length, 1, 'no unchecked refresh after policy');
  assert.equal(provider.getTrip('trip-1').nodes[0].price.amount, 250.25);
  assert.match(result.recoveries[0].message.body, /250.25 USD/);
  const confirmation = result.audit.findIndex(entry => entry.action === 'CONFIRM_NEW');
  const release = result.audit.findIndex(entry => entry.action === 'RELEASE_OLD');
  assert.ok(confirmation >= 0 && release > confirmation);
});

for (const payment of [undefined, { awaiting_payment: true }]) {
  test(`Duffel payment status ${JSON.stringify(payment)} does not confirm a referenced order`, async () => {
    const calls = stubDuffel({ confirm: order => ({ ...order, payment_status: payment }) });
    const provider = createProvider({ bookingProvider: 'duffel' });
    seedCancelledTrip(provider);
    let searches = 0;
    const args = { tripId: 'trip-1', provider, searchReplacements: async () => { searches++; return [option('a'), option('b')]; } };
    const first = await runRecovery(args);
    const second = await runRecovery(args);
    assert.equal(first.recoveries[0].execution.status, 'REVIEW_REQUIRED');
    assert.equal(second.recoveries[0].execution.status, 'REVIEW_REQUIRED');
    assert.equal(searches, 1);
    assert.equal(calls.filter(call => call.method === 'POST').length, 1);
    assert.equal(provider.getState().bookings.find(b => b.id === 'trip-1-old').status, 'CONFIRMED');
  });
}

test('a lost Duffel POST response reconciles by metadata without another search or order', async () => {
  const calls = stubDuffel({ afterCreate: () => { throw new Error('lost response after airline booked'); } });
  const provider = createProvider({ bookingProvider: 'duffel' });
  seedCancelledTrip(provider);
  let searches = 0;
  const args = { tripId: 'trip-1', provider, searchReplacements: async () => { searches++; return [option('a'), option('b')]; } };
  const first = await runRecovery(args);
  assert.equal(first.recoveries[0].execution.status, 'REVIEW_REQUIRED');
  assert.equal(provider.getTrip('trip-1').nodes[0].status, 'CANCELLED');
  const second = await runRecovery(args);
  assert.equal(second.recoveries[0].execution.status, 'RECOVERED');
  assert.equal(searches, 1);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(provider.getTrip('trip-1').nodes[0].bookingId, 'ord_test_1');
});

test('concurrent direct Duffel retries share one order POST', async () => {
  const calls = stubDuffel();
  const provider = createProvider({ bookingProvider: 'duffel' });
  const request = { tripId: 'trip-1', option: option('a'), idempotencyKey: 'concurrent-key' };
  const [a, b] = await Promise.all([provider.bookFlight(request), provider.bookFlight(request)]);
  assert.equal(a.id, b.id);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});

for (const kind of ['failed', 'pending', 'unauthorised', 'success']) {
  test(`orchestrator ${kind} recovery gates hotel and ride changes`, async () => {
    const provider = createProvider({ bookingProvider: 'simulator' });
    seedCancelledTrip(provider);
    provider.getTrip('trip-1').nodes.push(
      { id: 'hotel', type: 'HOTEL', status: 'CONFIRMED', refundable: true, dependsOn: ['flight'] },
      { id: 'ride', type: 'GROUND', status: 'CONFIRMED', dependsOn: ['flight'] },
    );
    if (kind === 'failed') provider.bookFlight = async () => { throw Object.assign(new Error('rejected'), { bookingOutcome: 'NOT_CREATED' }); };
    if (kind === 'pending') provider.getBooking = async () => ({ id: 'pending', status: 'PENDING' });
    const result = await runRecovery({ tripId: 'trip-1', provider,
      searchReplacements: async () => kind === 'unauthorised' ? [] : [option('a')] });
    const expected = kind === 'success' ? 'APPLIED' : 'SKIPPED';
    assert.deepEqual(result.recoveries[0].dependents.map(action => action.outcome), [expected, expected]);
    assert.equal(provider.getTrip('trip-1').nodes[1].status, kind === 'success' ? 'ADJUSTED' : 'CONFIRMED');
    assert.equal(provider.getTrip('trip-1').nodes[2].status, kind === 'success' ? 'ADJUSTED' : 'CONFIRMED');
  });
}

test('a new cancellation after recovery creates a new attempt for the replacement ticket', async () => {
  const provider = createProvider({ bookingProvider: 'simulator' });
  seedCancelledTrip(provider);
  let searches = 0;
  const args = { tripId: 'trip-1', provider, searchReplacements: async () => [option(`cycle-${++searches}`)] };
  const first = await runRecovery(args);
  provider.cancelNode('trip-1', 'flight');
  const second = await runRecovery(args);
  assert.equal(second.recoveries[0].execution.status, 'RECOVERED');
  assert.notEqual(first.recoveries[0].execution.bookingId, second.recoveries[0].execution.bookingId);
  assert.equal(searches, 2);
});

test('a graph update failure retains the confirmed ticket for retry without another purchase', async () => {
  const provider = createProvider({ bookingProvider: 'simulator' });
  seedCancelledTrip(provider);
  const replace = provider.replaceFlight;
  provider.replaceFlight = () => { throw new Error('update unavailable'); };
  let searches = 0;
  const args = { tripId: 'trip-1', provider, searchReplacements: async () => [option(`retry-${++searches}`)] };
  await assert.rejects(runRecovery(args), /update unavailable/);
  const count = provider.getState().bookings.length;
  provider.replaceFlight = replace;
  provider.getBooking = () => { throw new Error('a completed purchase should not be retried'); };
  const result = await runRecovery(args);
  assert.equal(result.recoveries[0].execution.status, 'RECOVERED');
  assert.equal(searches, 1);
  assert.equal(provider.getState().bookings.length, count);
});
