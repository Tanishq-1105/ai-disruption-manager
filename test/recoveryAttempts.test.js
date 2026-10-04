import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import * as attempts from '../src/store/recoveryAttempts.js';
import { closeMongo } from '../src/store/mongo.js';

beforeEach(() => attempts._resetForTests());
after(() => closeMongo());

const input = {
  memberTripId: 'member-trip-123',
  userId: 'member-123',
  originalOrderId: 'ord_original',
  flight: {
    airline: 'ZZ', flightNumber: 'ZZ123', origin: 'JFK', destination: 'LAX',
    departureTime: '2030-01-01T10:00:00', arrivalTime: '2030-01-01T13:00:00',
    price: { amount: 200, currency: 'EUR' },
  },
  disruption: { type: 'CANCELLED', minutes: null },
};

test('simulated disruption creates one durable attempt for a stable event identity', async () => {
  const first = await attempts.createSimulationAttempt(input);
  const duplicate = await attempts.createSimulationAttempt(input);
  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.state, 'DISRUPTION_SIMULATED');
  assert.deepEqual(duplicate.original, input.flight);
});

test('automatic poll and manual simulation share identity; local test disruption has a durable queue', async () => {
  const manual = await attempts.createSimulationAttempt(input);
  const detected = await attempts.createSimulationAttempt({ ...input, source: 'DUFFEL_POLL' });
  const automaticInput = { ...input, memberTripId: 'member-trip-automatic' };
  const automatic = await attempts.createSimulationAttempt({ ...automaticInput, source: 'DUFFEL_POLL' });
  const duplicate = await attempts.createSimulationAttempt(automaticInput);
  const localTest = await attempts.createSimulationAttempt({
    ...automaticInput, source: 'LOCAL_POLL_TEST',
  });
  const pending = await attempts.listPendingLocalPollTests();

  assert.equal(manual.id, detected.id);
  assert.equal(manual.state, 'DISRUPTION_SIMULATED');
  assert.equal(detected.state, 'DISRUPTION_SIMULATED');
  assert.equal(detected.source, 'MEMBER_SIMULATION');
  assert.equal(automatic.state, 'DISRUPTION_DETECTED');
  assert.equal(automatic.events[0].action, 'DISRUPTION_DETECTED');
  assert.equal(duplicate.id, automatic.id);
  assert.equal(localTest.state, 'DISRUPTION_DETECTED');
  assert.notEqual(localTest.id, automatic.id);
  assert.deepEqual(pending.map(attempt => attempt.memberTripId), [localTest.memberTripId]);
});

test('recovery claim is exclusive and checkpoints append ordered durable events', async () => {
  const created = await attempts.createSimulationAttempt(input);
  const first = await attempts.claim(created.recoveryKey, 'worker-a');
  assert.equal(first.leaseOwner, 'worker-a');
  assert.equal(await attempts.claim(created.recoveryKey, 'worker-b'), null);

  const checkpointed = await attempts.checkpoint(created.recoveryKey, 'worker-a',
    'BOOKING_REQUESTED', { idempotencyKey: 'stable-key', authorizedOption: { id: 'off_a' } },
    { action: 'BOOKING_REQUESTED' });
  assert.equal(checkpointed.state, 'BOOKING_REQUESTED');
  assert.deepEqual(checkpointed.events.map(event => event.sequence), [0, 1]);

  await attempts.releaseClaim(created.recoveryKey, 'worker-a');
  const resumed = await attempts.claim(created.recoveryKey, 'worker-b');
  assert.equal(resumed.state, 'BOOKING_REQUESTED');
  assert.equal(resumed.idempotencyKey, 'stable-key');
});

test('lease renewal and checkpoints reject stale claim owners', async () => {
  const created = await attempts.createSimulationAttempt(input);
  await attempts.claim(created.recoveryKey, 'worker-a', 1);
  await new Promise(resolve => setTimeout(resolve, 5));
  const resumed = await attempts.claim(created.recoveryKey, 'worker-b', 60_000);
  assert.equal(resumed.leaseOwner, 'worker-b');
  assert.equal(await attempts.renewClaim(created.recoveryKey, 'worker-a'), false);
  assert.equal(await attempts.checkpoint(created.recoveryKey, 'worker-a', 'BOOKING_REQUESTED'), null);
});

test('an expired lease cannot write checkpoints before another worker claims it', async () => {
  const created = await attempts.createSimulationAttempt(input);
  await attempts.claim(created.recoveryKey, 'worker-a', 1);
  await new Promise(resolve => setTimeout(resolve, 5));

  assert.equal(await attempts.checkpoint(created.recoveryKey, 'worker-a', 'BOOKING_REQUESTED'), null);
  const stored = await attempts.getByKey(created.recoveryKey);
  assert.equal(stored.state, 'DISRUPTION_SIMULATED');
  assert.deepEqual(stored.events.map(event => event.sequence), [0]);
});

async function awaitingApproval(expiresAt) {
  const created = await attempts.createSimulationAttempt(input);
  await attempts.claim(created.recoveryKey, 'worker-a');
  const approvalRequest = {
    expiresAt,
    binding: { fingerprint: 'a'.repeat(64) },
    option: { id: 'offer-approved' },
  };
  await attempts.checkpoint(created.recoveryKey, 'worker-a', 'AWAITING_APPROVAL', {
    approvalRequest,
  }, { action: 'MEMBER_APPROVAL_REQUIRED' });
  await attempts.releaseClaim(created.recoveryKey, 'worker-a');
  return created;
}

test('approval is owner-scoped, fingerprint-bound, and atomically recorded', async () => {
  const created = await awaitingApproval(new Date(Date.now() + 60_000).toISOString());
  const args = {
    recoveryKey: created.recoveryKey,
    userId: input.userId,
    fingerprint: 'a'.repeat(64),
  };
  assert.equal(await attempts.approve({ ...args, userId: 'another-member' }), null);
  assert.equal(await attempts.approve({ ...args, fingerprint: 'b'.repeat(64) }), null);
  const approved = await attempts.approve({
    ...args,
    approvedBy: 'LOCAL_BACKEND_TESTER',
  });

  assert.equal(approved.state, 'APPROVED');
  assert.equal(approved.approvedBy, 'LOCAL_BACKEND_TESTER');
  assert.equal(approved.events.at(-1).action, 'LOCAL_TESTER_APPROVED_RECOVERY');
  assert.equal(approved.events.at(-1).sequence, approved.events.length - 1);
  assert.equal(await attempts.approve(args), null);
});

test('expired approval cannot authorize a recovery', async () => {
  const created = await awaitingApproval(new Date(Date.now() - 1_000).toISOString());
  assert.equal(await attempts.approve({
    recoveryKey: created.recoveryKey,
    userId: input.userId,
    fingerprint: 'a'.repeat(64),
  }), null);
  assert.equal((await attempts.getByKey(created.recoveryKey)).state, 'AWAITING_APPROVAL');
});

test('rejection is owner-scoped and can only consume the current fingerprint', async () => {
  const created = await awaitingApproval(new Date(Date.now() + 60_000).toISOString());
  const args = {
    recoveryKey: created.recoveryKey,
    userId: input.userId,
    fingerprint: 'a'.repeat(64),
  };
  assert.equal(await attempts.reject({ ...args, userId: 'another-member' }), null);
  assert.equal(await attempts.reject({ ...args, fingerprint: 'b'.repeat(64) }), null);
  const rejected = await attempts.reject(args);

  assert.equal(rejected.state, 'REJECTED');
  assert.equal(rejected.rejectedBy, input.userId);
  assert.equal(rejected.events.at(-1).action, 'MEMBER_REJECTED_RECOVERY');
  assert.equal(await attempts.approve(args), null);
});
