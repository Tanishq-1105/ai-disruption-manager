import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as simulator from '../src/simulator/state.js';

test('cancelFlight marks the flight cancelled', () => {
  simulator._resetForTests();
  simulator.seedInventory('trip-1', [{ id: 'fl-1', scheduledArrival: '2026-08-08T10:00:00Z' }]);

  const flight = simulator.cancelFlight('trip-1', 'fl-1');

  assert.equal(flight.status, 'CANCELLED');
});

test('delayFlight shifts projected arrival by the given minutes', () => {
  simulator._resetForTests();
  simulator.seedInventory('trip-1', [{ id: 'fl-1', scheduledArrival: '2026-08-08T10:00:00Z' }]);

  const flight = simulator.delayFlight('trip-1', 'fl-1', 90);

  assert.equal(flight.projectedArrival, '2026-08-08T11:30:00.000Z');
});

test('cancelFlight on an unknown flight throws', () => {
  simulator._resetForTests();
  simulator.seedInventory('trip-1', []);

  assert.throws(() => simulator.cancelFlight('trip-1', 'missing'), /Unknown flight/);
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
