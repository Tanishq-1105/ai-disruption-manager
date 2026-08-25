import { randomUUID } from 'node:crypto';
import { getDb } from './mongo.js';

// Durable audit trail. The project invariant is that every automatic action and
// the policy decision that authorised it is eventually written down — until now
// the executor's entries lived only in the HTTP response and vanished with it.
//
// Two deliberate properties:
//
// - Writing audit records must never break a recovery. A member who has been
//   rebooked has been rebooked; losing the paperwork is bad, but failing the
//   rebooking because the paperwork failed is worse. Every write is best-effort
//   and reports rather than throws.
// - Records are append-only. There is no update or delete beyond the test
//   helper, because an audit trail you can quietly rewrite is not evidence.

let indexesEnsured = false;

async function auditCollection() {
  const db = await getDb();
  const collection = db.collection('audit');
  if (!indexesEnsured) {
    await collection.createIndex({ tripId: 1, at: -1 });
    await collection.createIndex({ recoveryId: 1 });
    indexesEnsured = true;
  }
  return collection;
}

/**
 * Persists one recovery run's entries as a batch. Returns what happened so the
 * caller can surface "recovered, but the audit write failed" rather than
 * pretending everything is fine.
 */
export async function recordEntries(entries, { tripId, recoveryId = randomUUID() } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { recoveryId, written: 0, persisted: true };
  }

  const documents = entries.map((entry, index) => ({
    id: randomUUID(),
    recoveryId,
    tripId: entry.tripId ?? tripId,
    // Preserves the order actions actually happened in, which matters because
    // "booked before released" is the safety claim this trail has to evidence.
    sequence: index,
    at: entry.at ?? new Date().toISOString(),
    action: entry.action,
    outcome: entry.outcome,
    authorisedBy: entry.authorisedBy ?? null,
    detail: entry.detail ?? null,
    optionId: entry.optionId ?? null,
    bookingId: entry.bookingId ?? null,
    idempotencyKey: entry.idempotencyKey ?? null,
    nodeId: entry.nodeId ?? null,
    attempt: entry.attempt ?? null,
    oldTicketRetained: entry.oldTicketRetained ?? null,
  }));

  try {
    const collection = await auditCollection();
    await collection.insertMany(documents, { ordered: true });
    return { recoveryId, written: documents.length, persisted: true };
  } catch (err) {
    // Deliberately swallowed — see the header.
    return { recoveryId, written: 0, persisted: false, error: err.message };
  }
}

export async function listByTrip(tripId, { limit = 200 } = {}) {
  const collection = await auditCollection();
  return collection
    .find({ tripId }, { projection: { _id: 0 } })
    .sort({ at: -1, sequence: -1 })
    .limit(limit)
    .toArray();
}

export async function listRecent({ limit = 100 } = {}) {
  const collection = await auditCollection();
  return collection
    .find({}, { projection: { _id: 0 } })
    .sort({ at: -1, sequence: -1 })
    .limit(limit)
    .toArray();
}

export async function listByRecovery(recoveryId) {
  const collection = await auditCollection();
  return collection
    .find({ recoveryId }, { projection: { _id: 0 } })
    .sort({ sequence: 1 })
    .toArray();
}

export async function _resetForTests() {
  const collection = await auditCollection();
  await collection.deleteMany({});
}
