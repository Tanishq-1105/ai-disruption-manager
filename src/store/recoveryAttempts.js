import { randomUUID } from 'node:crypto';
import { getDb } from './mongo.js';
import { config } from '../config.js';

let indexes;

async function collection() {
  const result = (await getDb()).collection('recoveryAttempts');
  indexes ??= Promise.all([
    result.createIndex({ recoveryKey: 1 }, { unique: true }),
    result.createIndex({ memberTripId: 1, updatedAt: -1 }),
    result.createIndex({ leaseUntil: 1 }),
    result.createIndex({ source: 1, state: 1, _id: 1 }),
  ]).catch(error => { indexes = null; throw error; });
  await indexes;
  return result;
}

export async function getLatestForMemberTrip({ memberTripId, userId }) {
  return (await collection()).findOne(
    { memberTripId, userId },
    { projection: { _id: 0 }, sort: { updatedAt: -1 } },
  );
}

export async function approve({ recoveryKey, userId, fingerprint, approvedBy = userId }) {
  const entries = await collection();
  const current = await entries.findOne({
    recoveryKey,
    userId,
    state: 'AWAITING_APPROVAL',
    'approvalRequest.binding.fingerprint': fingerprint,
    'approvalRequest.expiresAt': { $gt: new Date().toISOString() },
  }, { projection: { _id: 0, events: 1 } });
  if (!current) return null;
  const now = new Date().toISOString();
  return entries.findOneAndUpdate({
    recoveryKey,
    userId,
    state: 'AWAITING_APPROVAL',
    'approvalRequest.binding.fingerprint': fingerprint,
    'approvalRequest.expiresAt': { $gt: now },
  }, {
    $set: {
      state: 'APPROVED',
      approvedAt: now,
      approvedBy,
      updatedAt: now,
    },
    $push: {
      events: {
        sequence: current.events?.length ?? 0,
        state: 'APPROVED',
        at: now,
        action: approvedBy === userId ? 'MEMBER_APPROVED_RECOVERY' : 'LOCAL_TESTER_APPROVED_RECOVERY',
        approvedBy,
        fingerprint,
      },
    },
  }, { returnDocument: 'after', projection: { _id: 0 } });
}

export async function reject({ recoveryKey, userId, fingerprint }) {
  const entries = await collection();
  const current = await entries.findOne({
    recoveryKey,
    userId,
    state: 'AWAITING_APPROVAL',
    'approvalRequest.binding.fingerprint': fingerprint,
  }, { projection: { _id: 0, events: 1 } });
  if (!current) return null;
  const now = new Date().toISOString();
  return entries.findOneAndUpdate({
    recoveryKey,
    userId,
    state: 'AWAITING_APPROVAL',
    'approvalRequest.binding.fingerprint': fingerprint,
  }, {
    $set: { state: 'REJECTED', rejectedAt: now, rejectedBy: userId, updatedAt: now },
    $push: { events: {
      sequence: current.events?.length ?? 0,
      state: 'REJECTED',
      at: now,
      action: 'MEMBER_REJECTED_RECOVERY',
      fingerprint,
    } },
  }, { returnDocument: 'after', projection: { _id: 0 } });
}

export async function createSimulationAttempt({
  memberTripId, userId, originalOrderId, flight, disruption, source = 'MEMBER_SIMULATION',
}) {
  const keyParts = [memberTripId, originalOrderId];
  if (source === 'LOCAL_POLL_TEST') keyParts.push(source);
  keyParts.push(
    disruption.type, disruption.minutes ?? null,
    flight.flightNumber, flight.departureTime, flight.arrivalTime,
  );
  const recoveryKey = JSON.stringify(keyParts);
  const now = new Date().toISOString();
  const state = ['DUFFEL_POLL', 'LOCAL_POLL_TEST'].includes(source)
    ? 'DISRUPTION_DETECTED'
    : 'DISRUPTION_SIMULATED';
  const record = {
    id: randomUUID(), recoveryKey, memberTripId, userId, originalOrderId,
    original: structuredClone(flight),
    disruption: structuredClone(disruption),
    source,
    state,
    events: [{
      sequence: 0, state, at: now,
      action: state,
      source,
    }],
    createdAt: now, updatedAt: now,
  };
  const entries = await collection();
  try {
    await entries.insertOne(record);
    return record;
  } catch (error) {
    if (error.code !== 11000) throw error;
    return getByKey(recoveryKey);
  }
}

export async function getByKey(recoveryKey) {
  return (await collection()).findOne({ recoveryKey }, { projection: { _id: 0 } });
}

export async function listPendingLocalPollTests({ afterId, limit = 100 } = {}) {
  return (await collection()).find({
    source: 'LOCAL_POLL_TEST',
    state: { $nin: [
      'AWAITING_APPROVAL', 'COMPLETED', 'COMPLETED_NEEDS_ATTENTION',
      'NO_SAFE_OPTION', 'REJECTED', 'MEMBER_TRIP_CONFLICT',
    ] },
    ...(afterId ? { _id: { $gt: afterId } } : {}),
  }, {
    projection: { _id: 1, memberTripId: 1, userId: 1, state: 1 },
  }).sort({ _id: 1 }).limit(limit).toArray();
}

export async function getLatestLocalPollTestForMemberTrip(memberTripId) {
  return (await collection()).findOne(
    { memberTripId, source: 'LOCAL_POLL_TEST' },
    { projection: { _id: 0 }, sort: { updatedAt: -1 } },
  );
}

export async function getLatestForTrip({ memberTripId, airline, flightNumber }) {
  return (await collection()).findOne({
    memberTripId, 'original.airline': airline, 'original.flightNumber': flightNumber,
  }, { projection: { _id: 0 }, sort: { updatedAt: -1 } });
}

export async function claim(recoveryKey, owner, leaseMs = 60_000) {
  const now = Date.now();
  const record = await (await collection()).findOneAndUpdate({
    recoveryKey,
    state: { $nin: [
      'COMPLETED', 'COMPLETED_NEEDS_ATTENTION', 'NO_SAFE_OPTION', 'REJECTED',
      'MEMBER_TRIP_CONFLICT',
    ] },
    $or: [{ leaseUntil: { $lte: now } }, { leaseUntil: { $exists: false } }, { leaseOwner: owner }],
  }, {
    $set: { leaseOwner: owner, leaseUntil: now + leaseMs, updatedAt: new Date(now).toISOString() },
  }, { returnDocument: 'after', projection: { _id: 0 } });
  return record ?? null;
}

export async function renewClaim(recoveryKey, owner, leaseMs = 60_000) {
  const now = Date.now();
  const result = await (await collection()).updateOne({
    recoveryKey, leaseOwner: owner, leaseUntil: { $gt: now },
  }, { $set: { leaseUntil: now + leaseMs, updatedAt: new Date(now).toISOString() } });
  return result.modifiedCount === 1;
}

export async function checkpoint(recoveryKey, owner, state, fields = {}, event = {}) {
  const now = new Date().toISOString();
  const entries = await collection();
  const current = await entries.findOne({ recoveryKey, leaseOwner: owner }, {
    projection: { _id: 0, events: 1 },
  });
  if (!current) return null;
  const sequence = current.events?.length ?? 0;
  return entries.findOneAndUpdate({
    recoveryKey, leaseOwner: owner, leaseUntil: { $gt: Date.now() },
  }, {
    $set: { ...fields, state, updatedAt: now },
    $push: { events: { sequence, state, at: now, ...event } },
  }, { returnDocument: 'after', projection: { _id: 0 } });
}

export async function releaseClaim(recoveryKey, owner) {
  await (await collection()).updateOne({ recoveryKey, leaseOwner: owner }, {
    $unset: { leaseOwner: '', leaseUntil: '' },
    $set: { updatedAt: new Date().toISOString() },
  });
}

export async function _resetForTests() {
  if (config.mongo.dbName !== 'travel_disruption_concierge_test') {
    throw new Error('Test database required');
  }
  await (await collection()).deleteMany({});
}
