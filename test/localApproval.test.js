import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  approveLocalMemberRecovery,
} from '../src/bookings/memberRecovery.js';
import { isLocalBackendTestingRequest } from '../src/routes/simulator.js';

const fingerprint = 'a'.repeat(64);

test('local tester approval is exact, unexpired, and recorded separately from member consent', async () => {
  const attempt = {
    userId: 'member-owner',
    state: 'AWAITING_APPROVAL',
    approvalRequest: {
      binding: { fingerprint },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  };
  const calls = [];
  const result = await approveLocalMemberRecovery({
    memberTripId: 'member-trip-id',
    airline: 'ZZ',
    flightNumber: 'ZZ123',
    fingerprint,
    dependencies: {
      recoveryAttempts: {
        async getLatestForTrip(args) {
          assert.deepEqual(args, {
            memberTripId: 'member-trip-id',
            airline: 'ZZ',
            flightNumber: 'ZZ123',
          });
          return attempt;
        },
      },
      async recoverMemberTrip(args) {
        calls.push(args);
        return { status: 'RECOVERED' };
      },
    },
  });

  assert.equal(result.status, 'RECOVERED');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].userId, 'member-owner');
  assert.equal(calls[0].approvalFingerprint, fingerprint);
  assert.equal(calls[0].approvalActor, 'LOCAL_BACKEND_TESTER');
});

test('local tester approval refuses stale, expired, invalid-expiry, or non-pending approvals', async () => {
  const attempt = {
    userId: 'member-owner',
    state: 'AWAITING_APPROVAL',
    approvalRequest: {
      binding: { fingerprint },
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    },
  };
  let recoveries = 0;
  const args = {
    memberTripId: 'member-trip-id',
    airline: 'ZZ',
    flightNumber: 'ZZ123',
    fingerprint,
    dependencies: {
      recoveryAttempts: { async getLatestForTrip() { return attempt; } },
      async recoverMemberTrip() { recoveries++; },
    },
  };
  assert.equal((await approveLocalMemberRecovery(args)).status, 'STALE_APPROVAL');
  attempt.approvalRequest.expiresAt = new Date(Date.now() + 60_000).toISOString();
  assert.equal((await approveLocalMemberRecovery({ ...args, fingerprint: 'b'.repeat(64) })).status, 'STALE_APPROVAL');
  attempt.approvalRequest.expiresAt = 'invalid';
  assert.equal((await approveLocalMemberRecovery(args)).status, 'STALE_APPROVAL');
  attempt.approvalRequest.expiresAt = new Date(Date.now() + 60_000).toISOString();
  attempt.state = 'COMPLETED';
  assert.equal((await approveLocalMemberRecovery(args)).status, 'STALE_APPROVAL');
  assert.equal(recoveries, 0);
});

test('backend interface approval is loopback-only and disabled in production', () => {
  const previous = process.env.NODE_ENV;
  const localRequest = { socket: { remoteAddress: '127.0.0.1' } };
  const remoteRequest = { socket: { remoteAddress: '192.0.2.20' } };
  try {
    process.env.NODE_ENV = 'development';
    assert.equal(isLocalBackendTestingRequest(localRequest), true);
    assert.equal(isLocalBackendTestingRequest(remoteRequest), false);
    process.env.NODE_ENV = 'production';
    assert.equal(isLocalBackendTestingRequest(localRequest), false);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
