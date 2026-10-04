import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemberRecoveryMonitor } from '../src/bookings/memberRecoveryMonitor.js';

const records = [
  { _id: 'order-1', id: 'trip-1', userId: 'member-1', orderId: 'duffel-order-1' },
  { _id: 'order-2', id: 'trip-2', userId: 'member-2', orderId: 'duffel-order-2' },
];

function createDependencies({ statuses = {}, failures = {}, alreadyHandled = false } = {}) {
  const calls = { pages: [], tracked: [], disruptions: [], recoveries: [] };
  return {
    calls,
    attemptStore: {
      async getLatestLocalPollTestForMemberTrip() {
        return null;
      },
      async listPendingLocalPollTests({ afterId, limit }) {
        calls.pendingAttemptPages ??= [];
        calls.pendingAttemptPages.push({ afterId, limit });
        return [];
      },
    },
    tripStore: {
      async listConfirmedForMonitoring({ afterId, limit }) {
        calls.pages.push({ afterId, limit });
        const start = afterId ? records.findIndex(record => record._id === afterId) + 1 : 0;
        return records.slice(start, start + limit);
      },
    },
    trackingProvider: {
      async trackMemberOrder({ orderId, id }) {
        calls.tracked.push({ orderId, id });
        if (failures[id]) throw new Error('fixture tracking failure');
        return {
          source: 'duffel',
          sandbox: true,
          bookingStatus: statuses[id] ?? 'CONFIRMED',
        };
      },
    },
    bookingService: {
      async simulateDisruption(args) {
        calls.disruptions.push(args);
        return {
          alreadyHandled,
          recoveryState: alreadyHandled ? 'NO_SAFE_OPTION' : 'DISRUPTION_DETECTED',
        };
      },
    },
    recoveryController: {
      async recoverMemberTrip(args) {
        calls.recoveries.push(args);
        return { status: 'AWAITING_APPROVAL' };
      },
    },
  };
}

test('poller automatically sends a verified cancelled sandbox trip through recovery', async () => {
  const dependencies = createDependencies({ statuses: { 'trip-1': 'CANCELLED' } });
  const monitor = createMemberRecoveryMonitor({ ...dependencies, batchSize: 1 });

  const summary = await monitor.pollNow();

  assert.deepEqual(summary, { skipped: false, checked: 2, cancelled: 1, failures: 0 });
  assert.deepEqual(dependencies.calls.pages, [
    { afterId: undefined, limit: 1 },
    { afterId: 'order-1', limit: 1 },
    { afterId: 'order-2', limit: 1 },
  ]);
  assert.deepEqual(dependencies.calls.disruptions, [{
    userId: 'member-1',
    id: 'trip-1',
    type: 'CANCELLED',
    source: 'DUFFEL_POLL',
    expectedOrderId: 'duffel-order-1',
  }]);
  assert.deepEqual(dependencies.calls.recoveries, [{
    userId: 'member-1',
    memberTripId: 'trip-1',
  }]);
});

test('poller does not recover confirmed bookings or repeat handled cancellations', async () => {
  const confirmed = createDependencies();
  const first = await createMemberRecoveryMonitor(confirmed).pollNow();
  assert.equal(first.cancelled, 0);
  assert.equal(confirmed.calls.recoveries.length, 0);

  const handled = createDependencies({
    statuses: { 'trip-1': 'CANCELLED' },
    alreadyHandled: true,
  });
  await createMemberRecoveryMonitor(handled).pollNow();
  assert.equal(handled.calls.disruptions.length, 1);
  assert.equal(handled.calls.recoveries.length, 0);
});

test('poller resumes an existing review-required recovery without another disruption simulation', async () => {
  const dependencies = createDependencies({
    statuses: { 'trip-1': 'CANCELLED' },
    alreadyHandled: true,
  });
  dependencies.bookingService.simulateDisruption = async args => {
    dependencies.calls.disruptions.push(args);
    return { alreadyHandled: true, recoveryState: 'REVIEW_REQUIRED' };
  };

  await createMemberRecoveryMonitor(dependencies).pollNow();

  assert.equal(dependencies.calls.disruptions.length, 1);
  assert.deepEqual(dependencies.calls.recoveries, [{
    userId: 'member-1',
    memberTripId: 'trip-1',
  }]);
});

test('local test disruption is durable and immediately uses the poller recovery path', async () => {
  const dependencies = createDependencies();
  const savedTrip = {
    id: 'trip-1',
    userId: 'member-1',
    orderId: 'duffel-order-1',
  };
  dependencies.tripStore.getConfirmedForMonitoringById = async id =>
    id === savedTrip.id ? savedTrip : null;
  dependencies.bookingService.simulateDisruption = async args => {
    dependencies.calls.disruptions.push(args);
    return { recoveryId: 'recovery-1', alreadyHandled: false };
  };
  dependencies.recoveryController.recoverMemberTrip = async args => {
    dependencies.calls.recoveries.push(args);
    return { status: 'AWAITING_APPROVAL' };
  };

  const monitor = createMemberRecoveryMonitor({
    ...dependencies,
    allowLocalTestDisruptions: true,
  });
  const result = await monitor.createLocalTestDisruption({ memberTripId: 'trip-1' });

  assert.equal(result.recoveryId, 'recovery-1');
  assert.equal(result.state, 'AWAITING_APPROVAL');
  assert.deepEqual(dependencies.calls.disruptions, [{
    userId: 'member-1',
    id: 'trip-1',
    type: 'CANCELLED',
    source: 'LOCAL_POLL_TEST',
    expectedOrderId: 'duffel-order-1',
  }]);
  assert.deepEqual(dependencies.calls.recoveries, [{
    userId: 'member-1',
    memberTripId: 'trip-1',
  }]);
});

test('local test endpoint resumes an unfinished attempt instead of creating another disruption', async () => {
  const dependencies = createDependencies();
  const existing = {
    id: 'recovery-existing',
    userId: 'member-1',
    memberTripId: 'trip-1',
    state: 'REVIEW_REQUIRED',
  };
  dependencies.attemptStore.getLatestLocalPollTestForMemberTrip = async () => existing;
  let disruptions = 0;
  dependencies.bookingService.simulateDisruption = async () => { disruptions++; };
  dependencies.recoveryController.recoverMemberTrip = async args => {
    dependencies.calls.recoveries.push(args);
    return { status: 'REVIEW_REQUIRED' };
  };
  const monitor = createMemberRecoveryMonitor({
    ...dependencies,
    allowLocalTestDisruptions: true,
  });

  const result = await monitor.createLocalTestDisruption({ memberTripId: 'trip-1' });

  assert.equal(result.recoveryId, existing.id);
  assert.equal(result.alreadyHandled, true);
  assert.equal(disruptions, 0);
  assert.deepEqual(dependencies.calls.recoveries, [{
    userId: 'member-1',
    memberTripId: 'trip-1',
  }]);
});

test('local test endpoint does not create a new attempt while approval is pending', async () => {
  const dependencies = createDependencies();
  dependencies.attemptStore.getLatestLocalPollTestForMemberTrip = async () => ({
    id: 'recovery-awaiting-approval',
    state: 'AWAITING_APPROVAL',
  });
  let disruptions = 0;
  dependencies.bookingService.simulateDisruption = async () => { disruptions++; };
  const monitor = createMemberRecoveryMonitor({
    ...dependencies,
    allowLocalTestDisruptions: true,
  });

  const result = await monitor.createLocalTestDisruption({ memberTripId: 'trip-1' });

  assert.equal(result.state, 'AWAITING_APPROVAL');
  assert.equal(result.alreadyHandled, true);
  assert.equal(disruptions, 0);
});

test('local test disruption fails closed when the poller is not sandbox-enabled', async () => {
  const dependencies = createDependencies();
  let disruptions = 0;
  dependencies.bookingService.simulateDisruption = async () => { disruptions++; };
  const monitor = createMemberRecoveryMonitor({
    ...dependencies,
    allowLocalTestDisruptions: false,
  });

  await assert.rejects(
    monitor.createLocalTestDisruption({ memberTripId: 'trip-1' }),
    error => error.code === 'LOCAL_TEST_DISABLED',
  );
  assert.equal(disruptions, 0);
});

test('poller resumes a durable local test disruption after a process restart', async () => {
  const dependencies = createDependencies();
  let pending = [{
    _id: 'attempt-1',
    userId: 'member-1',
    memberTripId: 'trip-1',
    state: 'DISRUPTION_DETECTED',
  }];
  dependencies.attemptStore.listPendingLocalPollTests = async () => {
    const batch = pending;
    pending = [];
    return batch;
  };

  const summary = await createMemberRecoveryMonitor(dependencies).pollNow();

  assert.equal(summary.failures, 0);
  assert.deepEqual(dependencies.calls.recoveries, [{
    userId: 'member-1',
    memberTripId: 'trip-1',
  }]);
});

test('poll failures are isolated to one trip and reported in the result', async () => {
  const dependencies = createDependencies({
    statuses: { 'trip-2': 'CANCELLED' },
    failures: { 'trip-1': true },
  });
  const monitor = createMemberRecoveryMonitor(dependencies);

  const summary = await monitor.pollNow();

  assert.deepEqual(summary, { skipped: false, checked: 2, cancelled: 1, failures: 1 });
  assert.equal(dependencies.calls.recoveries.length, 1);
  assert.equal(dependencies.calls.recoveries[0].memberTripId, 'trip-2');
});

test('overlapping poll passes are skipped', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const dependencies = createDependencies();
  dependencies.tripStore.listConfirmedForMonitoring = async () => {
    await waiting;
    return [];
  };
  const monitor = createMemberRecoveryMonitor(dependencies);

  const active = monitor.pollNow();
  const overlapping = await monitor.pollNow();
  release();

  assert.equal(overlapping.skipped, true);
  assert.equal((await active).skipped, false);
});
