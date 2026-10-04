import { randomUUID } from 'node:crypto';
import { runRecovery } from '../agent/recovery.js';
import {
  buildApprovalBinding, DEFAULT_POLICY, evaluateFlightChange, POLICY_VERSION,
} from '../agent/policy.js';
import { viabilityIssues } from '../agent/options.js';
import { config } from '../config.js';
import { provider } from '../providers/index.js';
import * as flightSearch from '../providers/search.js';
import * as audit from '../store/audit.js';
import * as memberTrips from '../store/memberTrips.js';
import * as recoveryAttempts from '../store/recoveryAttempts.js';

const AUTO_POLICIES = ['COST_CAP', 'ARRIVAL_WINDOW', 'OVERNIGHT', 'CABIN', 'NON_REFUNDABLE'];
const REVIEW_STATES = new Set([
  'BOOKING_REQUESTED', 'ORDER_CREATED', 'NEW_CONFIRMED', 'OLD_RELEASE_PENDING',
  'OLD_RELEASED', 'COMPLETED_NEEDS_ATTENTION', 'MEMBER_TRIP_UPDATE_PENDING',
  'MEMBER_TRIP_UPDATED', 'REVIEW_REQUIRED',
]);

function publicApproval(attempt) {
  const request = attempt?.approvalRequest;
  if (!request) return null;
  return {
    status: attempt.state,
    option: request.option,
    total: request.preparedQuote && {
      amount: Number(request.preparedQuote.amount),
      currency: request.preparedQuote.currency,
    },
    expiresAt: request.expiresAt,
    violations: request.violations,
    binding: request.binding,
    policyVersion: request.policyVersion,
  };
}

function publicEvents(attempt) {
  return (attempt?.events ?? []).map(event => ({
    sequence: event.sequence,
    at: event.at,
    state: event.state,
    action: event.action,
    outcome: event.outcome,
    detail: typeof event.detail === 'string' ? event.detail.slice(0, 300) : undefined,
    optionId: event.optionId,
    bookingId: event.bookingId,
  }));
}

export function buildMemberApprovalRequest(candidate, prepared, original, policy) {
  const option = prepared?.option;
  if (!option || option.id !== candidate.option.id
      || option.offerId !== candidate.option.offerId
      || !Number.isFinite(Date.parse(prepared.expiresAt))
      || Date.parse(prepared.expiresAt) <= Date.now()
      || Number(prepared.amount) !== option.price?.amount
      || prepared.currency !== option.price?.currency
      || typeof option.refundable !== 'boolean'
      || typeof original.refundable !== 'boolean') return null;
  const issues = viabilityIssues(option, {
    readyAt: original.departureTime,
    readyAtOffsetHours: original.departureOffsetHours,
    requiredOrigin: original.origin,
    requiredDestination: original.destination,
  });
  const evaluation = evaluateFlightChange({ option, original, policy });
  if (issues.length || !evaluation.violations.length
      || !evaluation.violations.every(issue => AUTO_POLICIES.includes(issue.rule))
      || !['SCHEDULE', 'ITINERARY', 'CABIN', 'REFUNDABILITY_KNOWN'].every(rule =>
        evaluation.checks.some(check => check.rule === rule && check.passed))) return null;
  const quoteVersion = prepared.version ?? `${option.offerId}:${prepared.expiresAt}`;
  return {
    option: structuredClone(option),
    preparedQuote: structuredClone(prepared),
    policy: structuredClone(policy),
    policyVersion: POLICY_VERSION,
    quoteVersion,
    expiresAt: prepared.expiresAt,
    violations: structuredClone(evaluation.violations),
    binding: buildApprovalBinding({ option, policy, quoteVersion }),
  };
}

export async function prepareMemberApprovalRequest({
  candidate, original, policy, passenger, recoveryProvider = provider,
}) {
  const prepared = await recoveryProvider.prepareFlight({ option: candidate.option, passenger });
  return buildMemberApprovalRequest(candidate, prepared, original, policy);
}

export async function getMemberRecoveryStatus({ userId, memberTripId, dependencies = {} }) {
  const attemptStore = dependencies.recoveryAttempts ?? recoveryAttempts;
  const attempt = await attemptStore.getLatestForMemberTrip({ memberTripId, userId });
  if (!attempt) return null;
  return {
    recoveryId: attempt.id,
    state: attempt.state,
    disruption: attempt.disruption,
    updatedAt: attempt.updatedAt,
    approval: publicApproval(attempt),
    events: publicEvents(attempt),
    result: attempt.result ?? null,
  };
}

export async function recoverMemberTrip({
  userId, memberTripId, approvalFingerprint = null, approvalActor = null, dependencies = {},
}) {
  const memberProvider = dependencies.provider ?? provider;
  const searchProvider = dependencies.search ?? flightSearch;
  const auditStore = dependencies.audit ?? audit;
  const tripStore = dependencies.memberTrips ?? memberTrips;
  const attemptStore = dependencies.recoveryAttempts ?? recoveryAttempts;
  const recoveryRunner = dependencies.runRecovery ?? runRecovery;
  const recoveryConfig = dependencies.config ?? config;
  let attempt = await attemptStore.getLatestForMemberTrip({ memberTripId, userId });
  if (!attempt) return { status: 'NOT_FOUND', detail: 'No simulated disruption exists for this trip.' };
  const record = await tripStore.getById(userId, memberTripId);
  if (!record) return { status: 'NOT_FOUND', detail: 'Saved member trip not found.' };

  if (approvalFingerprint) {
    if (attempt.state !== 'AWAITING_APPROVAL') {
      return { status: attempt.state, detail: 'This recovery is no longer awaiting approval.' };
    }
    attempt = await attemptStore.approve({
      recoveryKey: attempt.recoveryKey, userId, fingerprint: approvalFingerprint,
      approvedBy: approvalActor ?? userId,
    });
    if (!attempt) return { status: 'STALE_APPROVAL', detail: 'The quote or approval expired. Review the updated terms.' };
  }

  if (['COMPLETED', 'COMPLETED_NEEDS_ATTENTION', 'NO_SAFE_OPTION', 'REJECTED',
    'MEMBER_TRIP_CONFLICT'].includes(attempt.state)) {
    return { status: attempt.state, detail: 'This recovery attempt is already terminal.' };
  }
  if (attempt.state === 'AWAITING_APPROVAL'
      && Date.parse(attempt.approvalRequest?.expiresAt) > Date.now()) {
    return { status: attempt.state, approval: publicApproval(attempt) };
  }

  const owner = randomUUID();
  const claimed = await attemptStore.claim(attempt.recoveryKey, owner);
  if (!claimed) return { status: 'IN_PROGRESS', detail: 'Another worker owns this recovery attempt.' };
  attempt = claimed;
  const resumeOnly = REVIEW_STATES.has(attempt.state);
  const wasApproved = attempt.state === 'APPROVED';
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    attemptStore.renewClaim(attempt.recoveryKey, owner).then(renewed => {
      if (!renewed) leaseLost = true;
    }).catch(() => { leaseLost = true; });
  }, 20_000);
  heartbeat.unref?.();
  let confirmedReplacement = null;

  try {
    const checkpoint = async (state, fields = {}, event = {}) => {
      if (leaseLost) throw new Error('Recovery lease was lost; no further side effect is permitted.');
      attempt = await attemptStore.checkpoint(attempt.recoveryKey, owner, state, fields, event);
      if (!attempt) throw new Error('Recovery claim was lost; no further side effect is permitted.');
      return attempt;
    };

    const replacementAlreadySaved = Boolean(attempt.newOrderId && record.orderId === attempt.newOrderId);
    if (replacementAlreadySaved) {
      await checkpoint('MEMBER_TRIP_UPDATED', { newOrderId: record.orderId }, {
        action: 'MEMBER_TRIP_UPDATE_RECONCILED', bookingId: record.orderId,
      });
      await checkpoint('COMPLETED', {}, { action: 'RECOVERY_COMPLETED' });
      return { status: 'COMPLETED', updatedBooking: record };
    }
    if (record.status !== 'CONFIRMED' || record.orderId !== attempt.originalOrderId) {
      await checkpoint('MEMBER_TRIP_CONFLICT', {}, { action: 'MEMBER_TRIP_CONFLICT' });
      return { status: 'MEMBER_TRIP_CONFLICT', detail: 'The saved booking changed; no purchase was attempted.' };
    }

    const policy = {
      ...DEFAULT_POLICY,
      costCap: recoveryConfig.policy.costCap,
    };
    const tripId = `member-recovery-${attempt.id}`;
    const nodeId = `member-flight-${record.id}`;
    const original = attempt.original;
    memberProvider.seedTrip(tripId, [{
      id: nodeId, type: 'FLIGHT', status: 'CONFIRMED', bookingId: attempt.originalOrderId,
      origin: original.origin, destination: original.destination, airline: original.airline,
      flightNumber: original.flightNumber, cabin: original.cabin,
      price: original.price ?? record.total ?? record.quote.total,
      refundable: original.refundable,
      departureOffsetHours: original.segments?.[0]?.departureOffsetHours,
      arrivalOffsetHours: original.segments?.at(-1)?.arrivalOffsetHours,
      stops: original.stops, durationMinutes: original.durationMinutes,
      segments: structuredClone(original.segments ?? []),
      scheduledDeparture: original.departureTime, scheduledArrival: original.arrivalTime,
      dependsOn: [],
    }]);
    if (attempt.disruption.type === 'CANCELLED') memberProvider.cancelNode(tripId, nodeId);
    else memberProvider.delayFlight(tripId, nodeId, attempt.disruption.minutes);

    if (attempt.state === 'DISRUPTION_SIMULATED') {
      await checkpoint('CLAIMED', { originalSnapshot: {
        memberTripId, originalOrderId: attempt.originalOrderId,
        memberTripRevision: record.updatedAt, policy, policyVersion: POLICY_VERSION,
      } }, { action: 'RECOVERY_CLAIMED' });
    }
    await checkpoint(resumeOnly ? 'RECONCILING' : 'ASSESSING', {}, {
      action: resumeOnly ? 'READ_ONLY_RECONCILIATION' : 'ASSESSING',
    });

    const approvedRecovery = wasApproved
      ? {
        ...attempt,
        approvalRequest: attempt.approvalRequest,
        policyVersion: attempt.approvalRequest.policyVersion,
        approvedAt: attempt.approvedAt,
        approvedBy: attempt.approvedBy,
      }
      : null;
    const recovery = await recoveryRunner({
      tripId,
      provider: memberProvider,
      policy,
      maxAttempts: 6,
      bookingPassenger: record.passenger,
      bookingMetadata: { tripshield_booking_id: record.id },
      durableRecovery: {
        resumeOnly,
        record: attempt,
        checkpoint,
        approvedRecovery,
      },
      searchReplacements: async ({ origin, destination, departureDate }) => {
        const { results } = await searchProvider.searchFlights({
          origin, destination, departuredate: departureDate,
        });
        return results;
      },
    });
    const persistedAudit = await auditStore.recordEntries(
      recovery.audit.map(entry => ({ ...entry, tripId: memberTripId })),
      { tripId: memberTripId },
    );
    const recoveryRow = recovery.recoveries[0];
    const execution = recoveryRow?.execution;

    if (execution?.bookingId && execution.status?.startsWith('RECOVERED')) {
      const flight = execution.option;
      confirmedReplacement = {
        orderId: execution.bookingId,
        bookingReference: execution.bookingReference ?? null,
        flight,
        total: execution.total,
      };
      await checkpoint('MEMBER_TRIP_UPDATE_PENDING', { newOrderId: execution.bookingId }, {
        action: 'MEMBER_TRIP_UPDATE_PENDING', bookingId: execution.bookingId,
      });
      const savedTrip = await tripStore.replaceConfirmedOrder(
        record.userId, record.id, record.orderId, record.updatedAt, {
          status: 'CONFIRMED',
          orderId: execution.bookingId,
          bookingReference: execution.bookingReference,
          quote: { ...record.quote, offerId: flight.offerId ?? flight.id, flight, expiresAt: null },
          total: execution.total,
          message: recoveryRow.message?.body ?? null,
        },
      );
      if (!savedTrip) {
        return { status: 'MEMBER_TRIP_CONFLICT', oldOrderId: record.orderId, updatedBooking: confirmedReplacement };
      }

      await checkpoint('MEMBER_TRIP_UPDATED', { newOrderId: execution.bookingId }, {
        action: 'MEMBER_TRIP_UPDATED', bookingId: execution.bookingId,
      });
      await checkpoint(execution.status === 'RECOVERED' ? 'COMPLETED' : 'COMPLETED_NEEDS_ATTENTION', {}, {
        action: execution.status === 'RECOVERED' ? 'RECOVERY_COMPLETED' : 'RECOVERY_NEEDS_ATTENTION',
      });
      return {
        status: execution.status,
        updatedBooking: {
          orderId: savedTrip.orderId,
          bookingReference: savedTrip.bookingReference ?? null,
          flight: savedTrip.quote?.flight ?? null,
          total: savedTrip.total ?? savedTrip.quote?.total ?? null,
        },
        recoveryId: persistedAudit.recoveryId,
        auditPersisted: persistedAudit.persisted,
        result: recovery,
      };
    }

    if (execution?.status === 'NOTHING_AUTHORISED' && recoveryRow?.approvalCandidate) {
      const approvalRequest = await prepareMemberApprovalRequest({
        candidate: recoveryRow.approvalCandidate,
        original,
        policy,
        passenger: record.passenger,
        recoveryProvider: memberProvider,
      });
      if (approvalRequest) {
        await checkpoint('AWAITING_APPROVAL', { approvalRequest }, {
          action: 'MEMBER_APPROVAL_REQUIRED',
          optionId: approvalRequest.option.id,
          fingerprint: approvalRequest.binding.fingerprint,
          expiresAt: approvalRequest.expiresAt,
        });
        return { status: 'AWAITING_APPROVAL', approval: publicApproval(attempt) };
      }
    }

    if (execution?.status === 'REVIEW_REQUIRED') {
      await checkpoint('REVIEW_REQUIRED', {
        newOrderId: execution.pendingBookingId ?? attempt.newOrderId ?? null,
      }, { action: 'REVIEW_REQUIRED', detail: execution.detail ?? null });
    } else {
      await checkpoint('NO_SAFE_OPTION', {}, { action: 'NO_SAFE_OPTION' });
    }
    return { status: execution?.status ?? 'NO_SAFE_OPTION', result: recovery };
  } catch (error) {
    console.error(`[member-recovery] trip ${memberTripId} failed: ${error.name}`);
    try {
      if (REVIEW_STATES.has(attempt.state) || ['AUTHORIZED', 'BOOKING_REQUESTED'].includes(attempt.state)) {
        await attemptStore.checkpoint(attempt.recoveryKey, owner, 'REVIEW_REQUIRED', {}, {
          action: 'RECOVERY_INTERRUPTED',
          detail: 'side-effect outcome requires read-only reconciliation',
        });
      }
    } catch (checkpointError) {
      console.error(`[member-recovery] checkpoint failed for ${memberTripId}: ${checkpointError.name}`);
    }
    return {
      status: 'REVIEW_REQUIRED',
      detail: 'Processing failed. Inspect the recovery audit and Duffel orders before retrying.',
      updatedBooking: confirmedReplacement,
    };
  } finally {
    clearInterval(heartbeat);
    await attemptStore.releaseClaim(attempt.recoveryKey, owner);
  }
}

export async function rejectMemberRecovery({ userId, memberTripId, approvalFingerprint, dependencies = {} }) {
  const attemptStore = dependencies.recoveryAttempts ?? recoveryAttempts;
  const attempt = await attemptStore.getLatestForMemberTrip({ memberTripId, userId });
  if (!attempt) return null;
  return attemptStore.reject({
    recoveryKey: attempt.recoveryKey, userId, fingerprint: approvalFingerprint,
  });
}

export async function approveLocalMemberRecovery({
  memberTripId, airline, flightNumber, fingerprint, dependencies = {},
}) {
  const attemptStore = dependencies.recoveryAttempts ?? recoveryAttempts;
  const recovery = dependencies.recoverMemberTrip ?? recoverMemberTrip;
  const attempt = await attemptStore.getLatestForTrip({ memberTripId, airline, flightNumber });
  if (!attempt || attempt.state !== 'AWAITING_APPROVAL'
      || attempt.approvalRequest?.binding?.fingerprint !== fingerprint
      || !Number.isFinite(Date.parse(attempt.approvalRequest?.expiresAt))
      || Date.parse(attempt.approvalRequest.expiresAt) <= Date.now()) {
    return { status: 'STALE_APPROVAL', detail: 'This exact sandbox approval is no longer current.' };
  }
  return recovery({
    userId: attempt.userId,
    memberTripId,
    approvalFingerprint: fingerprint,
    approvalActor: 'LOCAL_BACKEND_TESTER',
    dependencies: dependencies.recoveryDependencies,
  });
}
