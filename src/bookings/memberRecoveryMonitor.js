import { config } from '../config.js';
import { provider } from '../providers/index.js';
import * as memberTrips from '../store/memberTrips.js';
import * as recoveryAttempts from '../store/recoveryAttempts.js';
import { createBookingService } from './service.js';
import * as memberRecovery from './memberRecovery.js';

const TERMINAL_RECOVERY_STATES = new Set([
  'AWAITING_APPROVAL',
  'COMPLETED',
  'COMPLETED_NEEDS_ATTENTION',
  'NO_SAFE_OPTION',
  'REJECTED',
  'MEMBER_TRIP_CONFLICT',
]);

export function createMemberRecoveryMonitor({
  tripStore = memberTrips,
  trackingProvider = provider,
  bookingService = createBookingService({ provider: trackingProvider, store: tripStore }),
  recoveryController = memberRecovery,
  attemptStore = recoveryAttempts,
  batchSize = config.memberRecoveryPolling.batchSize,
  allowLocalTestDisruptions = config.memberRecoveryPolling.enabled !== false
    && process.env.NODE_ENV !== 'production'
    && config.providers.booking === 'duffel'
    && config.duffel.accessToken?.startsWith('duffel_test_'),
} = {}) {
  let running = false;

  async function resumeLocalTestDisruptions(summary) {
    let afterId;
    while (true) {
      const attempts = await attemptStore.listPendingLocalPollTests({ afterId, limit: batchSize });
      if (!attempts.length) break;
      afterId = attempts.at(-1)._id;
      for (const attempt of attempts) {
        try {
          const result = await recoveryController.recoverMemberTrip({
            userId: attempt.userId,
            memberTripId: attempt.memberTripId,
          });
          console.info(
            `[member-recovery-monitor] local test ${attempt.memberTripId}: ${result.status}`,
          );
        } catch (error) {
          summary.failures++;
          console.error(
            `[member-recovery-monitor] local test ${attempt.memberTripId} failed: ${error.name}`,
          );
        }
      }
      if (attempts.length < batchSize) break;
    }
  }

  async function pollNow() {
    if (running) return { skipped: true, checked: 0, cancelled: 0, failures: 0 };
    running = true;
    const summary = { skipped: false, checked: 0, cancelled: 0, failures: 0 };
    let afterId;

    try {
      await resumeLocalTestDisruptions(summary);
      while (true) {
        const records = await tripStore.listConfirmedForMonitoring({ afterId, limit: batchSize });
        if (!records.length) break;
        afterId = records.at(-1)._id;

        for (const record of records) {
          summary.checked++;
          try {
            if (typeof trackingProvider.trackMemberOrder !== 'function') {
              throw new Error('Duffel order tracking is unavailable');
            }
            const tracking = await trackingProvider.trackMemberOrder({
              orderId: record.orderId,
              id: record.id,
            });
            if (tracking.source !== 'duffel' || tracking.sandbox !== true) {
              throw new Error('Monitoring received an unverified non-sandbox order');
            }
            if (tracking.bookingStatus !== 'CANCELLED') continue;

            summary.cancelled++;
            const disruption = await bookingService.simulateDisruption({
              userId: record.userId,
              id: record.id,
              type: 'CANCELLED',
              source: 'DUFFEL_POLL',
              expectedOrderId: record.orderId,
            });
            if (disruption.alreadyHandled
                && TERMINAL_RECOVERY_STATES.has(disruption.recoveryState)) continue;

            const result = await recoveryController.recoverMemberTrip({
              userId: record.userId,
              memberTripId: record.id,
            });
            console.info(
              `[member-recovery-monitor] trip ${record.id}: ${result.status}`,
            );
          } catch (error) {
            summary.failures++;
            console.error(
              `[member-recovery-monitor] trip ${record.id} check failed: ${error.name}`,
            );
          }
        }

        if (records.length < batchSize) break;
      }
      return summary;
    } finally {
      running = false;
    }
  }

  async function createLocalTestDisruption({ memberTripId }) {
    if (!allowLocalTestDisruptions) {
      const error = new Error('Local disruption testing requires a non-production Duffel sandbox.');
      error.code = 'LOCAL_TEST_DISABLED';
      throw error;
    }
    const existing = await attemptStore.getLatestLocalPollTestForMemberTrip(memberTripId);
    if (existing?.state === 'AWAITING_APPROVAL') {
      return {
        recoveryId: existing.id,
        state: existing.state,
        alreadyHandled: true,
      };
    }
    if (existing && !TERMINAL_RECOVERY_STATES.has(existing.state)) {
      const resumed = await recoveryController.recoverMemberTrip({
        userId: existing.userId,
        memberTripId: existing.memberTripId,
      });
      return {
        recoveryId: existing.id,
        state: resumed.status,
        alreadyHandled: true,
        recovery: resumed,
      };
    }
    const record = await tripStore.getConfirmedForMonitoringById(memberTripId);
    if (!record) {
      const error = new Error('Confirmed Duffel sandbox trip not found.');
      error.code = 'TRIP_NOT_FOUND';
      throw error;
    }

    const disruption = await bookingService.simulateDisruption({
      userId: record.userId,
      id: record.id,
      type: 'CANCELLED',
      source: 'LOCAL_POLL_TEST',
      expectedOrderId: record.orderId,
    });
    if (disruption.alreadyHandled
        && TERMINAL_RECOVERY_STATES.has(disruption.recoveryState)) {
      return {
        recoveryId: disruption.recoveryId,
        state: disruption.recoveryState,
        alreadyHandled: true,
      };
    }
    const recovery = await recoveryController.recoverMemberTrip({
      userId: record.userId,
      memberTripId: record.id,
    });
    return {
      recoveryId: disruption.recoveryId,
      state: recovery.status,
      alreadyHandled: disruption.alreadyHandled === true,
      recovery,
    };
  }

  return { pollNow, createLocalTestDisruption };
}

export const memberRecoveryMonitor = createMemberRecoveryMonitor();

export function startMemberRecoveryMonitor({
  intervalMs = config.memberRecoveryPolling.intervalMs,
  ...dependencies
} = {}) {
  if (config.memberRecoveryPolling.enabled === false
      || config.providers.booking !== 'duffel'
      || !config.duffel.accessToken?.startsWith('duffel_test_')) {
    console.info(
      '[member-recovery-monitor] disabled; requires polling enabled, Duffel booking, and a Duffel test token',
    );
    return () => {};
  }

  const monitor = dependencies.monitor ?? memberRecoveryMonitor;
  let stopped = false;
  let timer;
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(async () => {
      try {
        await monitor.pollNow();
      } catch (error) {
        console.error(`[member-recovery-monitor] poll failed: ${error.name}`);
      } finally {
        schedule();
      }
    }, intervalMs);
    timer.unref?.();
  };

  void monitor.pollNow().catch(error => {
    console.error(`[member-recovery-monitor] initial poll failed: ${error.name}`);
  }).finally(schedule);

  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
