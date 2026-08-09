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
