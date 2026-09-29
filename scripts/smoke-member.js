// Live sandbox check. Start a temporary backend on port 4002 first.
// Creates its own account/order and cleans up only those records.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { config } from '../src/config.js';
import { provider } from '../src/providers/index.js';
import { getDb, closeMongo } from '../src/store/mongo.js';
import { signToken } from '../src/auth/tokens.js';

assert.ok(config.duffel.accessToken?.startsWith('duffel_test_'), 'A Duffel test token is required');
const base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4002';
const origin = process.env.SMOKE_ORIGIN || 'JFK';
const destination = process.env.SMOKE_DESTINATION || 'LAX';
const checks = [];
const orders = new Set();
let token, userId, quote, trip;
const passenger = { title: 'mr', gender: 'm', given_name: 'Test', family_name: 'Traveller',
  born_on: '1990-01-01', email: 'test@example.com', phone_number: '+442080160509',
  passport: { number: '123456789', country: 'GB', expiresOn: '2035-01-01' } };
function check(name, condition) {
  checks.push(Boolean(condition));
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`);
}
async function api(path, { body, auth = token, key } = {}) {
  const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  const raw = await response.text();
  return { status: response.status, data: raw ? JSON.parse(raw) : null };
}
try {
  check('health remains public', (await api('/health')).status === 200);
  check('saved trips require auth', (await api('/trips')).status === 401);
  const account = await api('/auth/signup', { body: { email: `member-smoke-${randomUUID()}@example.com`, password: `Test-${randomUUID()}` } });
  assert.equal(account.status, 201);
  token = account.data.token; userId = account.data.user.id;
  check('member account created', Boolean(token && userId));
  const date = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const search = await api(`/search/flights?origin=${origin}&destination=${destination}&departuredate=${date}`);
  check('Duffel offers returned', search.status === 200 && search.data.source === 'duffel' && search.data.results.length > 0);
  const candidates = search.data.results.sort((a, b) => Number(b.airline === 'ZZ') - Number(a.airline === 'ZZ'));
  for (const candidate of candidates.slice(0, 4)) {
    const result = await api('/bookings/quote', { body: { offerId: candidate.offerId } });
    if (result.status !== 200) { console.log('Offer unavailable:', result.status, result.data.code); continue; }
    quote = result.data.quote;
    assert.equal(quote.status, 'QUOTED');
    check('server refreshed sandbox quote', quote.sandbox === true && quote.flight.source === 'duffel' && typeof quote.total.amount === 'string');
    check('quote alone is not protected', !(await api('/trips')).data.results.some(entry => entry.id === quote.id));
    let booked = await api('/bookings', { body: { quoteId: quote.id, version: quote.version, passenger }, key: quote.id });
    if (booked.status === 409 && booked.data.code === 'QUOTE_CHANGED') {
      console.log('Reviewing refreshed sandbox quote before confirming.');
      quote = booked.data.quote;
      booked = await api('/bookings', { body: { quoteId: quote.id, version: quote.version, passenger }, key: quote.id });
    }
    assert.ok([200, 202].includes(booked.status), `Booking HTTP ${booked.status}: ${booked.data.code}`);
    trip = booked.data.trip;
    if (trip.orderId) orders.add(trip.orderId);
    console.log('Booking outcome:', trip.status);
    if (trip.status === 'FAILED') continue;
    for (let attempt = 0; attempt < 3 && ['PENDING', 'REVIEW_REQUIRED', 'BOOKING'].includes(trip.status); attempt++) {
      trip = (await api(`/trips/${trip.id}`)).data.trip;
      if (trip.orderId) orders.add(trip.orderId);
    }
    break; // Never buy another offer after an ambiguous outcome.
  }
  assert.ok(trip, 'No bookable candidate');
  check('independently confirmed booking', trip.status === 'CONFIRMED' && trip.orderId?.startsWith('ord_') && Boolean(trip.bookingReference));
  assert.equal(trip.status, 'CONFIRMED');
  check('automatically in protected trips', (await api('/trips')).data.results.some(entry => entry.id === trip.id && entry.bookingReference === trip.bookingReference));
  const body = { quoteId: quote.id, version: quote.version, passenger };
  const retries = await Promise.all([api('/bookings', { body, key: quote.id }), api('/bookings', { body, key: quote.id })]);
  check('concurrent retries reuse order', retries.every(result => result.status === 200 && result.data.trip.orderId === trip.orderId));
  check('quote reload reuses order', (await api('/bookings/quote', { body: { offerId: quote.flight.offerId } })).data.quote.orderId === trip.orderId);
  const otherToken = signToken({ sub: randomUUID(), email: 'other-test@example.com' });
  check('other account cannot read trip', (await api(`/trips/${trip.id}`, { auth: otherToken })).status === 404);
  check('other account cannot track trip', (await api(`/trips/${trip.id}/tracking`, { auth: otherToken })).status === 404);
  check('other account has no trips', (await api('/trips', { auth: otherToken })).data.results.length === 0);
  const tracked = await api(`/trips/${trip.id}/tracking`);
  check('tracking returns Duffel order status', tracked.status === 200 && tracked.data.source === 'duffel' && tracked.data.bookingStatus === 'CONFIRMED');
  check('tracking returns changes without fake flight status', Array.isArray(tracked.data.changes) && tracked.data.mock !== true && tracked.data.status !== 'ON_TIME');
  check('legacy tracking has no demo fallback', (await api('/tracking/B6666')).status === 501);
  const db = await getDb();
  const stored = await db.collection('memberTrips').findOne({ id: trip.id, userId });
  check('order, passenger and audit persisted', stored.orderId === trip.orderId && stored.passenger.given_name === passenger.given_name && stored.audit.some(entry => entry.action === 'BOOKING_CONFIRMED'));
  check('one record for the offer', await db.collection('memberTrips').countDocuments({ userId, offerId: quote.flight.offerId }) === 1);
  check('metadata matches booking', (await provider.findMemberOrder({ orderId: trip.orderId, id: trip.id }))?.bookingReference === trip.bookingReference);
} catch (error) {
  console.error(error.message);
  check('live flow completed', false);
} finally {
  if (userId) {
    const db = await getDb();
    const records = await db.collection('memberTrips').find({ userId }).toArray();
    let cleanupComplete = true;
    for (const record of records) {
      if (record.orderId) orders.add(record.orderId);
      else if (['BOOKING', 'REVIEW_REQUIRED', 'PENDING'].includes(record.status)) {
        try {
          const found = await provider.findMemberOrder({ id: record.id, offerId: record.offerId });
          if (found?.orderId) orders.add(found.orderId);
          else { check('ambiguous test booking reconciled', false); cleanupComplete = false; }
        } catch {
          check('test booking reconciliation available', false);
          cleanupComplete = false;
        }
      }
    }
    for (const id of orders) {
      try {
        await provider.cancelBooking(id);
        const cancelled = (await provider.getBooking(id)).status === 'CANCELLED';
        check('test order cancellation verified', cancelled);
        cleanupComplete &&= cancelled;
      } catch (error) { console.error('Cleanup failed:', id, error.message); check('order cleanup', false); cleanupComplete = false; }
    }
    // Preserve evidence when an order remains unknown or cancellation fails.
    if (cleanupComplete) {
      await db.collection('memberTrips').deleteMany({ userId });
      await db.collection('history').deleteMany({ userId });
      await db.collection('users').deleteOne({ id: userId });
      check('temporary member data removed', await db.collection('memberTrips').countDocuments({ userId }) === 0);
    }
  }
  await closeMongo();
  console.log(`RESULT ${checks.filter(Boolean).length} passed, ${checks.filter(value => !value).length} failed`);
  if (checks.some(value => !value)) process.exitCode = 1;
}
