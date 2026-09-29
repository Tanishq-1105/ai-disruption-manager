// Live sandbox recovery check through the provider port. No dev server needed.
// Creates its own simulator trip, persists its audit, and cleans up its test order.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { config } from '../src/config.js';
import { createProvider } from '../src/providers/index.js';
import { searchFlights } from '../src/providers/search.js';
import { runRecovery } from '../src/agent/recovery.js';
import { DEFAULT_POLICY } from '../src/agent/policy.js';
import { arrivalUtcMinutes, departureUtcMinutes } from '../src/agent/options.js';
import * as audit from '../src/store/audit.js';
import { getDb, closeMongo } from '../src/store/mongo.js';

assert.ok(config.duffel.accessToken?.startsWith('duffel_test_'), 'Duffel test token required');
assert.equal(config.providers.search, 'duffel', 'Duffel search required');
const provider = createProvider({ bookingProvider: 'duffel' });
const tripId = `recovery-smoke-${randomUUID()}`;
const oldId = `${tripId}-original`;
const orders = new Set();
const attempts = [];
const sequence = [];
let passed = 0, failed = false, result;
function check(name, condition) { assert.ok(condition, name); passed++; console.log(`PASS ${name}`); }
const create = provider.bookFlight;
provider.bookFlight = async request => {
  const attempt = { ...request, rejected: false };
  attempts.push(attempt);
  sequence.push('book');
  try {
    const booking = await create(request);
    if (booking.id) orders.add(booking.id);
    return booking;
  } catch (error) { attempt.rejected = error.bookingOutcome === 'NOT_CREATED'; throw error; }
};
const lookup = provider.getBooking;
provider.getBooking = async id => {
  const booking = await lookup(id);
  sequence.push(booking.status === 'CONFIRMED' ? 'confirmed' : 'pending');
  return booking;
};
const release = provider.cancelBooking;
provider.cancelBooking = async id => {
  if (id === oldId) check('independent confirmation precedes original release', sequence.at(-1) === 'confirmed');
  sequence.push('release');
  return release(id);
};
try {
  const departuredate = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const { source, results } = await searchFlights({ origin: 'JFK', destination: 'LAX', departuredate });
  check('live Duffel sandbox search returned flights', source === 'duffel' && results.length > 0);
  // Use Duffel Airways test flights for a reproducible recovery. Avoid comparing
  // a local arrival day with a different UTC day in the demo's existing policy.
  const candidates = results.filter(option => option.airline === 'ZZ'
    && new Date(arrivalUtcMinutes(option) * 60_000).toISOString().slice(0, 10) === option.arrivalTime.slice(0, 10))
    .sort((a, b) => departureUtcMinutes(a) - departureUtcMinutes(b));
  assert.ok(candidates.length, 'No suitable Duffel Airways test flight');
  const chosen = candidates[0];
  const departure = new Date((departureUtcMinutes(chosen) - 60) * 60_000).toISOString();
  provider.seedTrip(tripId, [{
    id: 'flight', type: 'FLIGHT', status: 'CANCELLED', bookingId: oldId,
    origin: chosen.origin, destination: chosen.destination, airline: 'ZZ', cabin: chosen.cabin,
    scheduledDeparture: departure, scheduledArrival: new Date(arrivalUtcMinutes(chosen) * 60_000).toISOString(),
    price: chosen.price, dependsOn: [],
  }, { id: 'hotel', type: 'HOTEL', refundable: true, dependsOn: ['flight'] },
  { id: 'ride', type: 'GROUND', dependsOn: ['flight'] }]);
  const args = { tripId, provider,
    policy: { ...DEFAULT_POLICY, costCap: { amount: 300, currency: chosen.price.currency } },
    searchReplacements: async () => candidates, maxAttempts: 6 };
  result = await runRecovery(args);
  let recovery = result.recoveries[0];
  if (recovery.execution.status === 'REVIEW_REQUIRED') {
    console.log('Reconciling pending test order without another purchase.');
    const resumed = await runRecovery(args);
    result.audit.push(...resumed.audit);
    recovery = resumed.recoveries[0];
  }
  const persistence = await audit.recordEntries(result.audit, { tripId });
  check('recovery audit persisted', persistence.persisted);
  check('real order independently confirmed', recovery.execution.status === 'RECOVERED');
  check('old simulated ticket released', provider.getState().bookings.find(booking => booking.id === oldId).status === 'CANCELLED');
  const node = provider.getTrip(tripId).nodes[0];
  check('replacement saved in trip graph', node.bookingId === recovery.execution.bookingId && node.status === 'CONFIRMED');
  check('actual confirmed fare used', node.price.amount === recovery.execution.option.price.amount);
  check('dependents adjusted after confirmation', recovery.dependents.every(action => action.outcome === 'APPLIED'));
  const persisted = await audit.listByRecovery(persistence.recoveryId);
  const confirmation = persisted.findIndex(entry => entry.action === 'CONFIRM_NEW' && entry.outcome === 'BOOKED');
  const released = persisted.findIndex(entry => entry.action === 'RELEASE_OLD');
  check('durable audit proves confirm before release', confirmation >= 0 && released > confirmation);
  check('refreshed fare authorisation precedes purchase', persisted.findIndex(entry => entry.action === 'CHECK_REFRESHED_OFFER') < persisted.findIndex(entry => entry.action === 'BOOK_NEW'));
  const count = attempts.length;
  const repeated = await runRecovery(args);
  check('repeat recovery makes no purchase', repeated.recoveries.length === 0 && attempts.length === count);
  check('message uses confirmed replacement', recovery.message.body.includes(recovery.execution.option.flightNumber));
} catch (error) {
  failed = true;
  console.error(`FAIL ${error.message}`);
} finally {
  let cleanupComplete = true;
  for (const attempt of attempts.filter(entry => !entry.rejected)) {
    try {
      const booking = await provider.findRecoveryBooking(attempt);
      if (booking?.id) orders.add(booking.id);
      else cleanupComplete = false;
    } catch { cleanupComplete = false; }
  }
  for (const id of orders) {
    try {
      await release(id);
      check('sandbox order cancellation verified', (await lookup(id)).status === 'CANCELLED');
    } catch (error) { console.error(`Cleanup needs review for ${id}: ${error.message}`); cleanupComplete = false; }
  }
  try {
    if (cleanupComplete) {
      await (await getDb()).collection('audit').deleteMany({ tripId });
      console.log('Temporary recovery audit removed.');
    } else {
      failed = true;
      console.error(`Retained audit for manual review: ${tripId}`);
      if (!result) await audit.recordEntries(attempts.map(attempt => ({ action: 'BOOK_NEW', outcome: 'REVIEW_REQUIRED',
        authorisedBy: 'SMOKE_TEST', idempotencyKey: attempt.idempotencyKey, optionId: attempt.option.id })), { tripId });
    }
  } finally { await closeMongo(); }
  console.log(`RESULT ${passed} passed, ${failed ? 1 : 0} failed`);
  if (failed) process.exitCode = 1;
}
