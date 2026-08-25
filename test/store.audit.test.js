import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as audit from '../src/store/audit.js';
import { closeMongo } from '../src/store/mongo.js';

test.after(async () => { await closeMongo(); });

const entries = [
  { at: '2026-08-25T10:00:00Z', action: 'BOOK_NEW', outcome: 'BOOKING_FAILED', authorisedBy: 'WITHIN_LIMITS', oldTicketRetained: true, attempt: 1 },
  { at: '2026-08-25T10:00:01Z', action: 'BOOK_NEW', outcome: 'BOOKED', authorisedBy: 'WITHIN_LIMITS', bookingId: 'b-1', attempt: 2 },
  { at: '2026-08-25T10:00:02Z', action: 'RELEASE_OLD', outcome: 'OLD_RELEASED', authorisedBy: 'WITHIN_LIMITS', bookingId: 'old-1' },
];

test('records a recovery batch and reads it back by trip', async () => {
  await audit._resetForTests();
  const result = await audit.recordEntries(entries, { tripId: 'trip-a' });

  assert.equal(result.persisted, true);
  assert.equal(result.written, 3);
  assert.ok(result.recoveryId);

  const stored = await audit.listByTrip('trip-a');
  assert.equal(stored.length, 3);
  assert.equal(stored.every((e) => e.tripId === 'trip-a'), true);
});

// The trail's whole job is evidencing that the ordering rule held.
test('preserves the order actions happened in', async () => {
  await audit._resetForTests();
  const { recoveryId } = await audit.recordEntries(entries, { tripId: 'trip-b' });
  const inOrder = await audit.listByRecovery(recoveryId);

  assert.deepEqual(inOrder.map((e) => e.action), ['BOOK_NEW', 'BOOK_NEW', 'RELEASE_OLD']);
  assert.deepEqual(inOrder.map((e) => e.sequence), [0, 1, 2]);
  const booked = inOrder.findIndex((e) => e.outcome === 'BOOKED');
  const released = inOrder.findIndex((e) => e.action === 'RELEASE_OLD');
  assert.ok(booked < released, 'the trail must evidence book-before-release');
});

test('keeps the authorising rule and the retained-ticket flag', async () => {
  await audit._resetForTests();
  const { recoveryId } = await audit.recordEntries(entries, { tripId: 'trip-c' });
  const stored = await audit.listByRecovery(recoveryId);

  assert.equal(stored[0].authorisedBy, 'WITHIN_LIMITS');
  assert.equal(stored[0].oldTicketRetained, true);
  assert.equal(stored[1].bookingId, 'b-1');
});

test('an empty batch is a no-op, not an error', async () => {
  const result = await audit.recordEntries([], { tripId: 'trip-d' });
  assert.equal(result.persisted, true);
  assert.equal(result.written, 0);
});

test('entries carry their own tripId when the batch has none', async () => {
  await audit._resetForTests();
  await audit.recordEntries([{ tripId: 'own-trip', action: 'BOOK_NEW', outcome: 'BOOKED' }], {});
  assert.equal((await audit.listByTrip('own-trip')).length, 1);
});

test('listByTrip isolates one trip from another', async () => {
  await audit._resetForTests();
  await audit.recordEntries(entries, { tripId: 'trip-x' });
  await audit.recordEntries(entries, { tripId: 'trip-y' });
  assert.equal((await audit.listByTrip('trip-x')).length, 3);
  assert.equal((await audit.listRecent()).length, 6);
});
