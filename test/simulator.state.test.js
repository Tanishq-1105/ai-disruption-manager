import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as simulator from '../src/simulator/state.js';

test('cancelNode marks the node cancelled', () => {
  simulator._resetForTests();
  simulator.seedTrip('trip-1', [{ id: 'fl-1', type: 'FLIGHT', scheduledArrival: '2026-08-08T10:00:00Z' }]);

  const node = simulator.cancelNode('trip-1', 'fl-1');

  assert.equal(node.status, 'CANCELLED');
});

test('delayFlight shifts projected arrival by the given minutes', () => {
  simulator._resetForTests();
  simulator.seedTrip('trip-1', [{ id: 'fl-1', type: 'FLIGHT', scheduledArrival: '2026-08-08T10:00:00Z' }]);

  const flight = simulator.delayFlight('trip-1', 'fl-1', 90);

  assert.equal(flight.projectedArrival, '2026-08-08T11:30:00.000Z');
});

test('delayFlight on a non-flight node throws', () => {
  simulator._resetForTests();
  simulator.seedTrip('trip-1', [{ id: 'hotel-1', type: 'HOTEL' }]);

  assert.throws(() => simulator.delayFlight('trip-1', 'hotel-1', 30), /not a FLIGHT/);
});

test('cancelNode on an unknown node throws', () => {
  simulator._resetForTests();
  simulator.seedTrip('trip-1', []);

  assert.throws(() => simulator.cancelNode('trip-1', 'missing'), /Unknown node/);
});

test('bookFlight is idempotent for the same key', () => {
  simulator._resetForTests();

  const b1 = simulator.bookFlight({ tripId: 't1', option: { id: 'opt-1' }, idempotencyKey: 'key-1' });
  const b2 = simulator.bookFlight({ tripId: 't1', option: { id: 'opt-1' }, idempotencyKey: 'key-1' });

  assert.equal(b1.id, b2.id);
});

test('forceNextBookingFailure fails exactly one booking attempt, then clears', () => {
  simulator._resetForTests();
  simulator.setForceNextBookingFailure(true);

  assert.throws(
    () => simulator.bookFlight({ tripId: 't1', option: {}, idempotencyKey: 'key-2' }),
    /Simulated booking failure/
  );

  const booking = simulator.bookFlight({ tripId: 't1', option: {}, idempotencyKey: 'key-3' });
  assert.equal(booking.status, 'CONFIRMED');
});

test('re-seeding a trip clears its bookings and idempotency keys', () => {
  simulator._resetForTests();
  simulator.seedTrip('t1', [{ id: 'f1', type: 'FLIGHT' }]);
  const first = simulator.bookFlight({ tripId: 't1', option: { id: 'o1' }, idempotencyKey: 'k1' });

  // Same key inside one run must return the same booking — that is idempotency.
  assert.equal(
    simulator.bookFlight({ tripId: 't1', option: { id: 'o1' }, idempotencyKey: 'k1' }).id,
    first.id,
  );

  // But re-seeding is a fresh start, so the key is released.
  simulator.seedTrip('t1', [{ id: 'f1', type: 'FLIGHT' }]);
  const second = simulator.bookFlight({ tripId: 't1', option: { id: 'o1' }, idempotencyKey: 'k1' });
  assert.notEqual(second.id, first.id);
});

test('re-seeding one trip leaves another trip untouched', () => {
  simulator._resetForTests();
  simulator.seedTrip('keep', [{ id: 'f', type: 'FLIGHT' }]);
  const kept = simulator.bookFlight({ tripId: 'keep', option: { id: 'o' }, idempotencyKey: 'kk' });
  simulator.seedTrip('other', [{ id: 'f', type: 'FLIGHT' }]);
  assert.equal(
    simulator.bookFlight({ tripId: 'keep', option: { id: 'o' }, idempotencyKey: 'kk' }).id,
    kept.id,
  );
});

test('a node declaring a bookingId gets a pre-existing confirmed booking', () => {
  simulator._resetForTests();
  simulator.seedTrip('t2', [{ id: 'f1', type: 'FLIGHT', bookingId: 'pre-1' }]);
  const booking = simulator.getState().bookings.find((b) => b.id === 'pre-1');
  assert.ok(booking, 'the executor needs a real old ticket to release');
  assert.equal(booking.status, 'CONFIRMED');
  assert.equal(booking.preExisting, true);
});

test('adjustNode marks a dependent node as adjusted', () => {
  simulator._resetForTests();
  simulator.seedTrip('t3', [{ id: 'hotel', type: 'HOTEL' }]);
  const node = simulator.adjustNode({ tripId: 't3', nodeId: 'hotel', action: 'SHIFT_HOTEL' });
  assert.equal(node.status, 'ADJUSTED');
  assert.equal(node.adjustment.action, 'SHIFT_HOTEL');
});
