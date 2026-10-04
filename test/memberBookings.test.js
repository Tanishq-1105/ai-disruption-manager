import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createBookingService } from '../src/bookings/service.js';
import { createBookingRouter } from '../src/routes/bookings.js';
import * as store from '../src/store/memberTrips.js';
import * as recoveryAttempts from '../src/store/recoveryAttempts.js';
import { getMemberRecoveryStatus } from '../src/bookings/memberRecovery.js';
import { closeMongo } from '../src/store/mongo.js';
import { signToken } from '../src/auth/tokens.js';
import trackingRouter from '../src/routes/tracking.js';

beforeEach(async () => {
  await store._resetForTests();
  await recoveryAttempts._resetForTests();
});
after(() => closeMongo());

const passenger = { title: 'mr', gender: 'm', given_name: 'Test', family_name: 'Traveller',
  born_on: '1990-01-01', email: 'test@example.com', phone_number: '+442080160509' };
function setup() {
  let current = {
    offerId: 'off_test001', passengerId: 'pas_test', expiresAt: '2030-01-01T10:00:00Z', requiresPassport: false,
    total: { amount: '210.00', currency: 'EUR' },
    flight: { id: 'off_test001', offerId: 'off_test001', source: 'duffel', airline: 'ZZ', flightNumber: 'ZZ123',
      origin: 'JFK', destination: 'LAX', departureTime: '2030-01-02T10:00:00', arrivalTime: '2030-01-02T13:00:00',
      cabin: 'ECONOMY', stops: 0, durationMinutes: 360, segments: [], price: { amount: 210, currency: 'EUR' } },
  };
  const calls = [];
  const disruptions = [];
  const provider = {
    getFlightQuote: async () => structuredClone(current),
    createMemberOrder: async args => { calls.push(args); return { id: 'ord_test001' }; },
    findMemberOrder: async () => ({ orderId: 'ord_test001', status: 'CONFIRMED', bookingReference: 'TEST01', total: current.total }),
    seedTrip: (tripId, nodes) => {
      disruptions.push({ action: 'seed', tripId, nodes });
      return { id: tripId, nodes };
    },
    cancelNode: (tripId, nodeId) => {
      disruptions.push({ action: 'cancel', tripId, nodeId });
      return { id: nodeId, type: 'FLIGHT', status: 'CANCELLED' };
    },
    delayFlight: (tripId, nodeId, minutes) => {
      disruptions.push({ action: 'delay', tripId, nodeId, minutes });
      return { id: nodeId, type: 'FLIGHT', status: 'CONFIRMED', delayMinutes: minutes };
    },
  };
  const service = createBookingService({ provider, store });
  return { service, provider, calls, disruptions, current, change: update => { current = { ...current, ...update }; } };
}
const requestFor = (quote, overrides = {}) => ({ userId: 'member-a', quoteId: quote.id, version: quote.version,
  idempotencyKey: quote.id, passenger, ...overrides });

test('confirmed booking is automatically saved to its owner, with real reference and explicit confirmation audit', async () => {
  const { service, calls } = setup();
  const quote = await service.quote({ userId: 'member-a', offerId: 'off_test001' });
  assert.equal((await service.list('member-a')).length, 0, 'reviewing an offer does not protect a trip');
  const trip = await service.book(requestFor(quote));
  assert.equal(trip.status, 'CONFIRMED');
  assert.equal(trip.bookingReference, 'TEST01');
  assert.equal(trip.sandbox, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].passenger, passenger);
  assert.equal(calls[0].quote.total.amount, '210.00');
  assert.equal((await service.list('member-a'))[0].id, trip.id);
  assert.deepEqual(await service.list('member-b'), []);
  const stored = await store.getById('member-a', trip.id);
  assert.deepEqual(stored.audit.map(entry => entry.action), ['BOOK_REQUESTED', 'ORDER_CREATED', 'BOOKING_CONFIRMED']);
  assert.equal('passengerId' in trip, false);
  assert.equal('fingerprint' in trip, false);
});

test('owner can simulate a cancellation on a confirmed sandbox trip', async () => {
  const { service, disruptions } = setup();
  const quote = await service.quote({ userId: 'member-a', offerId: 'off_test001' });
  const trip = await service.book(requestFor(quote));
  const result = await service.simulateDisruption({ userId: 'member-a', id: trip.id, type: 'CANCELLED' });
  assert.equal(result.tripId, trip.id);
  assert.equal(result.disruption.type, 'CANCELLED');
  assert.equal(result.node.status, 'CANCELLED');
  assert.equal(disruptions[0].action, 'seed');
  assert.equal(disruptions[1].action, 'cancel');
  assert.equal(disruptions[0].nodes[0].bookingId, 'ord_test001');
  const status = await getMemberRecoveryStatus({ userId: 'member-a', memberTripId: trip.id });
  assert.equal(status.state, 'DISRUPTION_SIMULATED');
  assert.equal(await getMemberRecoveryStatus({ userId: 'member-b', memberTripId: trip.id }), null);
});

test('poll-triggered disruption rejects a stale original order ID', async () => {
  const { service, disruptions } = setup();
  const quote = await service.quote({ userId: 'member-a', offerId: 'off_test001' });
  const trip = await service.book(requestFor(quote));

  await assert.rejects(
    service.simulateDisruption({
      userId: 'member-a', id: trip.id, type: 'CANCELLED',
      source: 'DUFFEL_POLL', expectedOrderId: 'ord_stale',
    }),
    error => error.code === 'TRIP_CHANGED',
  );
  assert.deepEqual(disruptions, []);
});

test('disruption simulation is owner-scoped and validates delay input', async () => {
  const { service } = setup();
  const quote = await service.quote({ userId: 'member-a', offerId: 'off_test001' });
  const trip = await service.book(requestFor(quote));
  await assert.rejects(
    service.simulateDisruption({ userId: 'member-b', id: trip.id, type: 'CANCELLED' }),
    error => error.status === 404,
  );
  await assert.rejects(
    service.simulateDisruption({ userId: 'member-a', id: trip.id, type: 'DELAYED', minutes: 0 }),
    error => error.code === 'INVALID_DELAY',
  );
});

test('retry after a database reconnect and service restart returns the same order', async () => {
  const { service, provider, calls } = setup();
  const quote = await service.quote({ userId: 'member-a', offerId: 'off_test001' });
  const first = await service.book(requestFor(quote));
  await closeMongo();
  const restarted = createBookingService({ provider, store });
  const second = await restarted.book(requestFor(quote));
  assert.equal(second.orderId, first.orderId);
  assert.equal(calls.length, 1);
  assert.equal((await restarted.list('member-a')).length, 1);
});

test('concurrent submissions and quote reloads cannot create a second order', async () => {
  const { service, provider } = setup();
  const quote = await service.quote({ userId: 'member-a', offerId: 'off_test001' });
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let posts = 0;
  provider.createMemberOrder = async () => { posts++; started(); await gate; return { id: 'ord_test001' }; };
  const first = service.book(requestFor(quote));
  await entered;
  try {
    const second = await service.book(requestFor(quote));
    assert.equal(second.id, quote.id);
    const reload = await service.quote({ userId: 'member-a', offerId: 'off_test001' });
    assert.equal(reload.id, quote.id);
    assert.notEqual(reload.status, 'QUOTED');
  } finally { release(); }
  assert.equal((await first).status, 'CONFIRMED');
  assert.equal(posts, 1);
});

test('concurrent quote creation shares one durable booking ID', async () => {
  const { service } = setup();
  const quotes = await Promise.all(Array.from({ length: 4 }, () => service.quote({ userId: 'member-a', offerId: 'off_test001' })));
  assert.equal(new Set(quotes.map(q => q.id)).size, 1);
});

for (const changed of ['price', 'currency', 'itinerary']) {
  test(`${changed} change requires explicit review again before any order`, async () => {
    const { service, change, current, calls } = setup();
    const quote = await service.quote({ userId: 'member-a', offerId: 'off_test001' });
    change(changed === 'price' ? { total: { amount: '230.00', currency: 'EUR' } }
      : changed === 'currency' ? { total: { amount: '210.00', currency: 'USD' } }
        : { flight: { ...current.flight, departureTime: '2030-01-02T11:00:00' } });
    let refreshed;
    await assert.rejects(service.book(requestFor(quote)), error => {
      assert.equal(error.code, 'QUOTE_CHANGED');
      assert.equal(error.status, 409);
      refreshed = error.extra.quote;
      return true;
    });
    assert.equal(calls.length, 0);
    assert.notEqual(refreshed.version, quote.version);
    await assert.rejects(service.book(requestFor(quote)), error => error.code === 'QUOTE_CHANGED');
    assert.equal((await service.book(requestFor(refreshed))).status, 'CONFIRMED');
    assert.equal(calls.length, 1);
  });
}

test('a missing key or another passenger cannot reuse a booking request', async () => {
  const { service, calls } = setup();
  const quote = await service.quote({ userId: 'member-a', offerId: 'off_test001' });
  await assert.rejects(service.book(requestFor(quote, { idempotencyKey: undefined })), error => error.status === 400);
  await service.book(requestFor(quote));
  await assert.rejects(service.book(requestFor(quote, { passenger: { ...passenger, given_name: 'Someone' } })), error => error.status === 409);
  assert.equal(calls.length, 1);
});

test('another user cannot read or purchase an owned quote even knowing its IDs', async () => {
  const { service, calls } = setup();
  const quote = await service.quote({ userId: 'member-a', offerId: 'off_test001' });
  await assert.rejects(service.get('member-b', quote.id), error => error.status === 404);
  await assert.rejects(service.book(requestFor(quote, { userId: 'member-b' })), error => error.status === 404);
  assert.equal(calls.length, 0);
});

test('invalid passenger data and missing required passport fail before order creation', async () => {
  const { service, change, calls } = setup();
  change({ requiresPassport: true });
  const quote = await service.quote({ userId: 'member-a', offerId: 'off_test001' });
  for (const invalid of [passenger, { ...passenger, born_on: '2000-02-30' }, { ...passenger, phone_number: '123' }, { ...passenger, given_name: '' },
    { ...passenger, passport: { number: 123456789, country: 'GB', expiresOn: '2035-01-01' } }]) {
    await assert.rejects(service.book(requestFor(quote, { passenger: invalid })), error => error.code === 'INVALID_PASSENGER');
  }
  assert.equal(calls.length, 0);
  await service.book(requestFor(quote, { passenger: { ...passenger, passport: { number: '123456789', country: 'GB', expiresOn: '2035-01-01' } } }));
  assert.equal(calls[0].passenger.identity_documents[0].type, 'passport');
});

test('a provider rejection remains failed, without fallback or a second POST', async () => {
  const { service, provider } = setup();
  let posts = 0;
  provider.createMemberOrder = async () => { posts++; throw Object.assign(new Error('invalid offer'), { status: 422 }); };
  const quote = await service.quote({ userId: 'member-a', offerId: 'off_test001' });
  assert.equal((await service.book(requestFor(quote))).status, 'FAILED');
  assert.equal((await service.book(requestFor(quote))).status, 'FAILED');
  assert.equal(posts, 1);
  assert.deepEqual(await service.list('member-a'), []);
});

test('unconfirmed orders stay pending; a later lookup confirms without another purchase', async () => {
  const { service, provider, calls } = setup();
  const lookup = provider.findMemberOrder;
  provider.findMemberOrder = async () => null;
  const quote = await service.quote({ userId: 'member-a', offerId: 'off_test001' });
  assert.equal((await service.book(requestFor(quote))).status, 'PENDING');
  assert.equal((await service.list('member-a'))[0].status, 'PENDING');
  provider.findMemberOrder = lookup;
  assert.equal((await service.get('member-a', quote.id)).status, 'CONFIRMED');
  assert.equal(calls.length, 1);
});

test('a lost order response remains blocked until metadata lookup finds its order', async () => {
  const { service, provider } = setup();
  let posts = 0;
  provider.createMemberOrder = async () => { posts++; throw new Error('network response lost'); };
  provider.findMemberOrder = async () => null;
  const quote = await service.quote({ userId: 'member-a', offerId: 'off_test001' });
  assert.equal((await service.book(requestFor(quote))).status, 'REVIEW_REQUIRED');
  const restarted = createBookingService({ provider, store });
  assert.equal((await restarted.book(requestFor(quote))).status, 'REVIEW_REQUIRED');
  provider.findMemberOrder = async request => {
    assert.equal(request.id, quote.id);
    assert.equal(request.offerId, 'off_test001');
    return { orderId: 'ord_reconciled', bookingReference: 'FOUND1', status: 'CONFIRMED', total: { amount: '210.00', currency: 'EUR' } };
  };
  assert.equal((await restarted.get('member-a', quote.id)).orderId, 'ord_reconciled');
  assert.equal(posts, 1);
});

test('preflight outage does not purchase and lets the member retry safely', async () => {
  const { service, provider, calls } = setup();
  const quote = await service.quote({ userId: 'member-a', offerId: 'off_test001' });
  const original = provider.getFlightQuote;
  provider.getFlightQuote = async () => { throw new Error('offline'); };
  await assert.rejects(service.book(requestFor(quote)), error => error.status === 503);
  assert.equal(calls.length, 0);
  provider.getFlightQuote = original;
  assert.equal((await service.book(requestFor(quote))).status, 'CONFIRMED');
});

test('Duffel tracking is scoped to a saved member trip and does not accept schedule changes', async () => {
  const { service, provider } = setup();
  const quote = await service.quote({ userId: 'member-a', offerId: 'off_test001' });
  let checks = 0;
  provider.trackMemberOrder = async request => {
    checks++;
    assert.equal(request.orderId, 'ord_test001');
    assert.equal(request.id, quote.id);
    return { source: 'duffel', sandbox: true, bookingStatus: 'CONFIRMED', bookingReference: 'TEST01',
      checkedAt: '2030-01-01T09:00:00Z', changes: [{ id: 'aic_test', actionTaken: null }] };
  };
  await assert.rejects(service.track('member-a', quote.id), error => error.status === 409);
  await service.book(requestFor(quote));
  await assert.rejects(service.track('member-b', quote.id), error => error.status === 404);
  const tracking = await service.track('member-a', quote.id);
  assert.equal(checks, 1);
  assert.equal(tracking.source, 'duffel');
  assert.equal(tracking.changes[0].actionTaken, null);
  assert.equal((await store.getById('member-a', quote.id)).lastCheckedAt, tracking.checkedAt);
});

test('HTTP routes require auth, preserve public routes, and scope reads to the token owner', async () => {
  const { service } = setup();
  const app = express();
  app.use(express.json());
  app.use(createBookingRouter(service));
  app.use('/tracking', trackingRouter);
  app.get('/health', (req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, user, body) => fetch(`${base}${path}`, { method: body ? 'POST' : 'GET',
    headers: { ...(user ? { Authorization: `Bearer ${signToken({ sub: user, email: 'test@example.com' })}` } : {}), 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await call('/health')).status, 200);
    assert.equal((await call('/trips')).status, 401);
    const legacy = await call('/tracking/B6666');
    assert.equal(legacy.status, 501);
    assert.equal((await legacy.json()).code, 'SAVED_TRIP_REQUIRED');
    assert.equal((await call('/bookings/quote', null, { offerId: 'off_test001' })).status, 401);
    const response = await call('/bookings/quote', 'member-a', { offerId: 'off_test001', userId: 'member-b' });
    assert.equal(response.status, 200);
    const { quote } = await response.json();
    assert.equal((await call(`/trips/${quote.id}`, 'member-b')).status, 404);
    assert.equal((await call(`/trips/${quote.id}/tracking`, 'member-b')).status, 404);
    assert.equal((await call(`/trips/${quote.id}`, 'member-a')).status, 200);
    const noRecovery = await call(`/trips/${quote.id}/recovery`, 'member-a');
    assert.equal(noRecovery.status, 200);
    assert.equal((await noRecovery.json()).recovery, null);
    assert.equal((await call(`/trips/${quote.id}/recovery`, 'member-b')).status, 404);
    assert.equal((await call('/trips/missing-trip/recovery', 'member-a')).status, 404);
    assert.equal((await call(`/trips/${quote.id}/recovery/run`, null, {})).status, 401);
    const booked = await service.book(requestFor(quote));
    await service.simulateDisruption({ userId: 'member-a', id: booked.id, type: 'CANCELLED' });
    const ownRecovery = await call(`/trips/${quote.id}/recovery`, 'member-a');
    assert.equal((await ownRecovery.json()).recovery.state, 'DISRUPTION_SIMULATED');
    const otherRecovery = await call(`/trips/${quote.id}/recovery`, 'member-b');
    assert.equal(otherRecovery.status, 404);

    const attempt = await recoveryAttempts.getLatestForMemberTrip({
      memberTripId: quote.id, userId: 'member-a',
    });
    await recoveryAttempts.claim(attempt.recoveryKey, 'route-test');
    await recoveryAttempts.checkpoint(attempt.recoveryKey, 'route-test', 'BOOKING_REQUESTED', {}, {
      action: 'BOOKING_REQUESTED',
      detail: 'replacement order requested',
      idempotencyKey: 'private-idempotency-key',
    });
    await recoveryAttempts.releaseClaim(attempt.recoveryKey, 'route-test');
    const timelineResponse = await call(`/trips/${quote.id}/recovery`, 'member-a');
    const timeline = (await timelineResponse.json()).recovery;
    assert.equal(timeline.events.length, 2);
    assert.equal(timeline.events[1].action, 'BOOKING_REQUESTED');
    assert.equal('idempotencyKey' in timeline.events[1], false);

    assert.equal((await call(`/trips/${quote.id}/recovery/approve`, 'member-a', { fingerprint: 'x' })).status, 400);
    assert.equal((await call('/bookings/quote', 'member-a', { offerId: '../orders' })).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('recovery endpoints route owner identity and handle stale approvals', async () => {
  const { service } = setup();
  const calls = [];
  const recoveryController = {
    async getMemberRecoveryStatus(args) {
      calls.push({ route: 'status', ...args });
      return { recoveryId: 'recovery-1', state: 'DISRUPTION_SIMULATED', events: [] };
    },
    async recoverMemberTrip(args) {
      calls.push({ route: 'run', ...args });
      return args.approvalFingerprint === 'f'.repeat(64)
        ? { status: 'STALE_APPROVAL', detail: 'quote changed' }
        : { status: 'RECOVERED' };
    },
    async rejectMemberRecovery(args) {
      calls.push({ route: 'reject', ...args });
      return { state: 'REJECTED' };
    },
  };
  const app = express();
  app.use(express.json());
  app.use(createBookingRouter(service, recoveryController));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, user, body) => fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(user ? { Authorization: `Bearer ${signToken({ sub: user, email: 'test@example.com' })}` } : {}),
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const tripId = 'member-trip-1';
  const fingerprint = 'a'.repeat(64);
  try {
    assert.equal((await call(`/trips/${tripId}/recovery`, null)).status, 401);
    assert.equal((await call(`/trips/${tripId}/recovery/run`, null, {})).status, 401);

    const status = await call(`/trips/${tripId}/recovery`, 'member-a');
    assert.equal((await status.json()).recovery.state, 'DISRUPTION_SIMULATED');
    assert.equal((await call(`/trips/${tripId}/recovery/run`, 'member-a', {})).status, 200);
    assert.equal((await call(`/trips/${tripId}/recovery/approve`, 'member-a', {
      fingerprint: 'f'.repeat(64),
    })).status, 409);
    assert.equal((await call(`/trips/${tripId}/recovery/approve`, 'member-a', {
      fingerprint,
    })).status, 200);
    const rejected = await call(`/trips/${tripId}/recovery/reject`, 'member-a', { fingerprint });
    assert.equal((await rejected.json()).recovery.state, 'REJECTED');

    assert.ok(calls.every(entry => entry.userId === 'member-a'));
    assert.equal(calls[2].approvalFingerprint, 'f'.repeat(64));
    assert.equal(calls[3].approvalFingerprint, fingerprint);
    assert.equal(calls[4].approvalFingerprint, fingerprint);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
