// Safe Executor (Phase 6) — the only module in the agent core that changes the
// world. Everything it decides is still deterministic; what it adds is ordering
// and failure handling.
//
// THE ORDERING RULE, which nothing may reorder:
//
//     book the new ticket -> confirm it -> only then release the old one
//
// This build books directly with no seat-hold step, so that ordering is the
// single thing standing between a member and having no ticket at all. If a
// booking is definitively rejected, the old ticket is untouched and the next
// candidate is tried. An unknown outcome pauses further purchases.
//
// Three further safety positions, each encoded and tested below:
//
// - Every mutating request carries an idempotency key, so a retry of the same
//   attempt returns the original booking instead of buying a second seat.
// - A fallback candidate is re-checked against policy before it is booked. The
//   member authorised *an option*, not "whatever the agent finds next", and a
//   booking failure must not become a licence to spend more.
// - If releasing the old ticket fails after the new one is confirmed, the new
//   booking is NOT rolled back. Two tickets is a billing problem; zero tickets
//   is a stranded member. We take the billing problem and flag it.

import {
  evaluateFlightChange, DEFAULT_POLICY, DECISION, AUTONOMY, POLICY_VERSION, buildApprovalBinding,
} from './policy.js';
import { viabilityIssues, arrivalUtcMinutes, departureUtcMinutes } from './options.js';

export const OUTCOME = {
  BOOKED: 'BOOKED',
  BOOKING_FAILED: 'BOOKING_FAILED',
  NOT_AUTHORISED: 'NOT_AUTHORISED',
  OLD_RELEASED: 'OLD_RELEASED',
  OLD_RELEASE_FAILED: 'OLD_RELEASE_FAILED',
  NOT_CONFIRMED: 'NOT_CONFIRMED',
  PRECHECK_FAILED: 'PRECHECK_FAILED',
};

export const STATUS = {
  RECOVERED: 'RECOVERED',
  RECOVERED_NEEDS_ATTENTION: 'RECOVERED_NEEDS_ATTENTION',
  EXHAUSTED: 'EXHAUSTED',
  NOTHING_AUTHORISED: 'NOTHING_AUTHORISED',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
};

// Deterministic and stable: retrying the same attempt reuses the same key, so
// the provider returns the booking it already made rather than making another.
export function buildIdempotencyKey({ tripId, optionId, attempt }) {
  return `${tripId}:${optionId}:${attempt}`;
}

// Pending demo attempts remain attached to a recovery scope even if the next
// search would return different offer IDs. Persisted-member recovery uses its
// separate Mongo checkpoints.
const pendingByProvider = new WeakMap();
const MEMBER_APPROVABLE_RULES = new Set(['COST_CAP', 'ARRIVAL_WINDOW', 'OVERNIGHT', 'CABIN', 'NON_REFUNDABLE']);
export function getPendingRecovery({ provider, scope }) {
  return pendingByProvider.get(provider)?.get(scope) ?? null;
}

// Only forget a completed attempt after the orchestrator has saved its ticket.
// A later disruption of that updated flight then gets a new recovery attempt.
export function completeRecovery({ provider, scope }) {
  const entries = pendingByProvider.get(provider);
  if (entries?.get(scope)?.completed) entries.delete(scope);
}

function itinerary(option) {
  return JSON.stringify({
    origin: option?.origin, destination: option?.destination, cabin: option?.cabin,
    departure: departureUtcMinutes(option), arrival: arrivalUtcMinutes(option),
    flightNumber: option?.flightNumber, stops: option?.stops,
    segments: option?.segments?.map(segment => ({
      airline: segment.airline, flightNumber: segment.flightNumber,
      origin: segment.origin, destination: segment.destination,
    })),
  });
}

function sameSelectedItinerary(selected, refreshed) {
  return itinerary(selected) === itinerary(refreshed);
}

export async function executeRecovery({
  tripId, original, ranked = [], decision, provider, policy = DEFAULT_POLICY,
  maxAttempts = 3, audit = [], now = () => new Date().toISOString(),
  bookingPassenger, bookingMetadata,
  durableRecovery,
  approvedRecovery,
  scope = `${tripId}:${original?.bookingId ?? original?.nodeId ?? 'flight'}`,
}) {
  const record = entry => audit.push({ at: now(), tripId, ...entry });
  let pending = pendingByProvider.get(provider);
  if (!pending) { pending = new Map(); pendingByProvider.set(provider, pending); }
  const attempts = [];
  const result = (status, extra = {}) => ({ status, booking: null, attempts, audit,
    escalations: decision?.escalations ?? [], ...extra });
  const review = (entry, detail) => {
    record({ action: 'CONFIRM_NEW', outcome: OUTCOME.NOT_CONFIRMED, authorisedBy: 'CONFIRM_BEFORE_RELEASE',
      attempt: entry.attempt, optionId: entry.option.id, bookingId: entry.bookingId,
      idempotencyKey: entry.idempotencyKey, detail, oldTicketRetained: true });
    attempts.push({ attempt: entry.attempt, optionId: entry.option.id, outcome: OUTCOME.NOT_CONFIRMED, detail });
    return result(STATUS.REVIEW_REQUIRED, { pendingBookingId: entry.bookingId ?? null, detail });
  };

  async function confirmAndRelease(entry) {
    if (entry.completed) {
      attempts.push({ attempt: entry.attempt, optionId: entry.option.id, outcome: OUTCOME.BOOKED, bookingId: entry.bookingId });
      return result(entry.completed.status, { booking: entry.completed.booking, option: entry.completed.booking.option });
    }
    let confirmed;
    try {
      confirmed = entry.bookingId ? await provider.getBooking(entry.bookingId)
        : await provider.findRecoveryBooking?.({ option: entry.option, idempotencyKey: entry.idempotencyKey });
    } catch {
      return review(entry, 'Independent booking lookup failed; check this attempt before any further purchase.');
    }
    if (!confirmed?.id || (entry.bookingId && confirmed.id !== entry.bookingId)
        || confirmed.id === original?.bookingId || confirmed.status !== 'CONFIRMED') {
      return review(entry, 'The replacement is not independently confirmed; the original ticket and dependents are unchanged.');
    }
    if (durableRecovery && (confirmed.sandbox !== true
        || confirmed.metadata?.tripshield_booking_id !== durableRecovery.record.memberTripId
        || confirmed.metadata?.tripshield_recovery_key !== entry.idempotencyKey)) {
      return review(entry, 'The replacement order mode or member/recovery metadata could not be verified; the original ticket is retained.');
    }
    entry.bookingId = confirmed.id;
    if (!confirmed.option || itinerary(confirmed.option) !== itinerary(entry.option)
        || !Number.isFinite(confirmed.total?.amount)
        || confirmed.total.amount !== entry.option.price.amount
        || confirmed.total.currency !== entry.option.price.currency) {
      return review(entry, 'The confirmed order does not match the authorised fare or itinerary; review it before releasing the original.');
    }
    const booking = { ...confirmed, tripId, option: { ...entry.option, price: confirmed.total } };
    await durableRecovery?.checkpoint('NEW_CONFIRMED', {
      newOrderId: booking.id,
      confirmedBooking: booking,
    }, { action: 'NEW_CONFIRMED', bookingId: booking.id });
    record({ action: 'CONFIRM_NEW', outcome: OUTCOME.BOOKED, authorisedBy: 'CONFIRM_BEFORE_RELEASE',
      attempt: entry.attempt, optionId: entry.option.id, bookingId: booking.id,
      idempotencyKey: entry.idempotencyKey, detail: 'independent lookup verified the authorised order, fare and itinerary' });

    if (!entry.releaseOutcome && durableRecovery?.record.state !== 'OLD_RELEASED'
        && durableRecovery?.record.state !== 'MEMBER_TRIP_UPDATED'
        && durableRecovery?.record.state !== 'COMPLETED') {
      await durableRecovery?.checkpoint('OLD_RELEASE_PENDING', {
        newOrderId: booking.id,
      }, { action: 'OLD_RELEASE_PENDING', bookingId: original?.bookingId ?? null });
      entry.releaseOutcome = OUTCOME.OLD_RELEASED;
      if (original?.bookingId) {
        try {
          let oldBooking;
          if (durableRecovery) oldBooking = await provider.getBooking(original.bookingId);
          if (durableRecovery && (oldBooking?.id !== original.bookingId || oldBooking.sandbox !== true
              || oldBooking.metadata?.tripshield_booking_id !== durableRecovery.record.memberTripId)) {
            throw new Error('original sandbox order identity could not be verified');
          }
          if (oldBooking?.status !== 'CANCELLED') {
            if (durableRecovery && oldBooking?.status !== 'CONFIRMED') {
              throw new Error('original booking status could not be confirmed');
            }
            const released = await provider.cancelBooking(original.bookingId);
            if (released?.status !== 'CANCELLED') throw new Error('cancellation was not confirmed');
          }
        } catch {
          if (durableRecovery) {
            try {
              const reconciled = await provider.getBooking(original.bookingId);
              if (reconciled?.id === original.bookingId && reconciled.status === 'CANCELLED'
                  && reconciled.sandbox === true
                  && reconciled.metadata?.tripshield_booking_id === durableRecovery.record.memberTripId) {
                entry.releaseOutcome = OUTCOME.OLD_RELEASED;
              } else {
                entry.releaseOutcome = OUTCOME.OLD_RELEASE_FAILED;
              }
            } catch {
              entry.releaseOutcome = OUTCOME.OLD_RELEASE_FAILED;
            }
          } else {
            entry.releaseOutcome = OUTCOME.OLD_RELEASE_FAILED;
          }
        }
        record({ action: 'RELEASE_OLD', bookingId: original.bookingId, outcome: entry.releaseOutcome,
          authorisedBy: 'CONFIRM_BEFORE_RELEASE', detail: entry.releaseOutcome === OUTCOME.OLD_RELEASED
            ? 'old ticket released after independent confirmation'
            : 'could not confirm release of the old ticket; member may hold two bookings' });
      }
      await durableRecovery?.checkpoint(
        entry.releaseOutcome === OUTCOME.OLD_RELEASED ? 'OLD_RELEASED' : 'COMPLETED_NEEDS_ATTENTION',
        { newOrderId: booking.id, oldReleaseOutcome: entry.releaseOutcome },
        { action: 'RELEASE_OLD', bookingId: original?.bookingId ?? null, outcome: entry.releaseOutcome },
      );
    }
    attempts.push({ attempt: entry.attempt, optionId: entry.option.id, outcome: OUTCOME.BOOKED, bookingId: booking.id });
    entry.completed = { status: entry.releaseOutcome === OUTCOME.OLD_RELEASE_FAILED
      ? STATUS.RECOVERED_NEEDS_ATTENTION : STATUS.RECOVERED, booking };
    return result(entry.completed.status, { booking, option: booking.option });
  }

  // Resume only by reading an existing attempt, before policy or another search
  // can cause a second purchase. Its original authorisation is kept in the audit.
  const existing = pending.get(scope);
  if (existing) return confirmAndRelease(existing);

  if (durableRecovery?.resumeOnly) {
    const saved = durableRecovery.record;
    const option = saved.authorizedOption;
    if (!option || !saved.idempotencyKey) {
      return result(STATUS.REVIEW_REQUIRED, {
        detail: 'Persisted recovery is missing its authorized order attempt; no purchase was retried.',
      });
    }
    const entry = {
      option,
      attempt: saved.candidateAttempt ?? 1,
      idempotencyKey: saved.idempotencyKey,
      bookingId: saved.newOrderId ?? null,
      releaseOutcome: saved.oldReleaseOutcome ?? null,
    };
    pending.set(scope, entry);
    return confirmAndRelease(entry);
  }

  const autoAuthorised = decision?.actions?.some(action => action.action === 'REBOOK_FLIGHT'
    && action.autonomy === AUTONOMY.AUTO && action.rule === 'WITHIN_LIMITS' && !action.nodeId);
  const approvalRequest = approvedRecovery?.approvalRequest;
  const approvalOption = approvalRequest?.option;
  const approvalPrepared = approvalRequest?.preparedQuote;
  const approvalBinding = approvalOption && approvedRecovery?.approvedAt
    ? buildApprovalBinding({
      option: approvalOption,
      policy,
      quoteVersion: approvalPrepared?.version ?? `${approvalOption.offerId ?? approvalOption.id}:${approvalPrepared?.expiresAt}`,
    })
    : null;
  const approvalEvaluation = approvalOption
    ? evaluateFlightChange({ option: approvalOption, original, policy })
    : null;
  const memberApproved = Boolean(
    approvalBinding?.fingerprint
      && approvalBinding.fingerprint === approvalRequest.binding?.fingerprint
      && approvalRequest.policyVersion === POLICY_VERSION
      && approvedRecovery.policyVersion === POLICY_VERSION
      && Date.parse(approvalPrepared?.expiresAt) > Date.now()
      && approvalEvaluation?.violations.length > 0
      && approvalEvaluation.violations.every(issue => MEMBER_APPROVABLE_RULES.has(issue.rule))
      && ['SCHEDULE', 'ITINERARY', 'CABIN', 'REFUNDABILITY_KNOWN'].every(rule =>
        approvalEvaluation.checks.some(check => check.rule === rule && check.passed))
      && ranked.length === 1 && ranked[0].option.id === approvalOption.id,
  );
  if (!autoAuthorised && !memberApproved) {
    record({ action: 'REBOOK_FLIGHT', outcome: OUTCOME.NOT_AUTHORISED,
      authorisedBy: decision?.decision ?? DECISION.ESCALATE, detail: 'policy did not authorise an automatic rebooking' });
    return result(STATUS.NOTHING_AUTHORISED);
  }
  if (typeof provider.prepareFlight !== 'function' || typeof provider.getBooking !== 'function') {
    record({ action: 'REBOOK_FLIGHT', outcome: OUTCOME.NOT_AUTHORISED,
      authorisedBy: 'PROVIDER_CAPABILITY', detail: 'provider must support refreshed quotes and independent confirmation' });
    return result(STATUS.NOTHING_AUTHORISED);
  }

  for (const [index, candidate] of ranked.slice(0, maxAttempts).entries()) {
    const searched = candidate.option ?? candidate;
    const attempt = index + 1;
    let prepared;
    try {
      prepared = memberApproved
        ? approvalPrepared
        : await provider.prepareFlight({ option: searched, passenger: bookingPassenger });
    }
    catch (error) {
      attempts.push({ attempt, optionId: searched.id, outcome: OUTCOME.PRECHECK_FAILED, detail: error.message });
      record({ action: 'REFRESH_OFFER', outcome: OUTCOME.PRECHECK_FAILED, attempt, optionId: searched.id,
        authorisedBy: 'PRE_BOOKING_CHECK', detail: error.message, oldTicketRetained: true });
      continue; // No order POST has occurred.
    }
    const option = prepared?.option;
    const evaluation = evaluateFlightChange({ option, original, policy });
    const issues = option ? viabilityIssues(option, {
      readyAt: original?.departureTime,
      readyAtOffsetHours: original?.segments?.[0]?.departureOffsetHours ?? original?.departureOffsetHours,
      requiredOrigin: original?.origin,
      requiredDestination: original?.destination,
    }) : ['provider returned no refreshed itinerary'];
    if (option?.id !== searched.id) issues.push('refreshed offer does not match the selected offer');
    if (option && !sameSelectedItinerary(searched, option)) {
      issues.push('refreshed offer itinerary differs from the selected flight');
    }
    if (durableRecovery && (!Number.isFinite(Date.parse(prepared?.expiresAt))
        || Date.parse(prepared.expiresAt) <= Date.now()
        || Number(prepared.amount) !== option?.price?.amount
        || prepared.currency !== option?.price?.currency)) {
      issues.push('refreshed quote is expired or its exact fare differs from the prepared quote');
    }
    const approvedViolations = memberApproved
      && evaluation.violations.length > 0
      && evaluation.violations.every(issue => MEMBER_APPROVABLE_RULES.has(issue.rule))
      && ['SCHEDULE', 'ITINERARY', 'CABIN', 'REFUNDABILITY_KNOWN'].every(rule =>
        evaluation.checks.some(check => check.rule === rule && check.passed));
    const allowed = (evaluation.allowed || approvedViolations) && issues.length === 0;
    const detail = [...evaluation.violations.map(v => v.detail), ...issues].join('; ');
    record({ action: 'CHECK_REFRESHED_OFFER', attempt, optionId: searched.id,
      outcome: allowed ? 'AUTHORISED' : OUTCOME.NOT_AUTHORISED,
      authorisedBy: allowed ? (memberApproved ? 'MEMBER_APPROVAL' : 'WITHIN_LIMITS')
        : evaluation.violations[0]?.rule ?? 'VIABILITY',
      detail: allowed ? `authorised refreshed fare ${option.price.amount} ${option.price.currency}` : detail,
      oldTicketRetained: true });
    if (!allowed) {
      attempts.push({ attempt, optionId: searched.id, outcome: OUTCOME.NOT_AUTHORISED, detail });
      continue;
    }
    const idempotencyKey = buildIdempotencyKey({ tripId, optionId: option.id, attempt });
    const inFlight = pending.get(scope);
    if (inFlight) return confirmAndRelease(inFlight);
    const entry = { option, attempt, idempotencyKey };
    pending.set(scope, entry);
    record({ action: 'BOOK_NEW', attempt, optionId: option.id, idempotencyKey,
      outcome: 'REQUESTED', authorisedBy: memberApproved ? 'MEMBER_APPROVAL' : 'WITHIN_LIMITS',
      detail: `requesting ${option.flightNumber ?? option.id} at ${option.price.amount} ${option.price.currency}` });
    let created;
    if (durableRecovery) {
      const persisted = {
        authorizedOption: option,
        preparedQuote: prepared,
        idempotencyKey,
        candidateAttempt: attempt,
        policySnapshot: structuredClone(policy),
        policyVersion: POLICY_VERSION,
        decisionSnapshot: structuredClone(decision),
        originalSnapshot: structuredClone(original),
        approvalBinding: buildApprovalBinding({
          option, policy,
          quoteVersion: prepared?.version ?? `${option.offerId ?? option.id}:${prepared?.expiresAt}`,
        }),
      };
      await durableRecovery.checkpoint('AUTHORIZED', persisted, {
        action: 'CANDIDATE_AUTHORIZED', optionId: option.id, idempotencyKey,
        authorizedBy: memberApproved ? 'MEMBER_APPROVAL' : 'WITHIN_LIMITS',
        approvedBy: approvedRecovery?.approvedBy ?? null,
        approvedAt: approvedRecovery?.approvedAt ?? null,
      });
      await durableRecovery.checkpoint('BOOKING_REQUESTED', persisted, {
        action: 'BOOKING_REQUESTED', optionId: option.id, idempotencyKey,
      });
    }
    try {
      created = await provider.bookFlight({
        tripId, option, prepared, idempotencyKey,
        passenger: bookingPassenger, metadata: bookingMetadata,
      });
    }
    catch (error) {
      if (error.bookingOutcome !== 'NOT_CREATED') {
        return review(entry, 'Order creation outcome is unknown; reconcile this attempt before booking again.');
      }
      pending.delete(scope);
      attempts.push({ attempt, optionId: option.id, outcome: OUTCOME.BOOKING_FAILED, detail: error.message });
      record({ action: 'BOOK_NEW', attempt, optionId: option.id, idempotencyKey,
        outcome: OUTCOME.BOOKING_FAILED,
        authorisedBy: memberApproved ? 'MEMBER_APPROVAL' : 'WITHIN_LIMITS',
        detail: error.message, oldTicketRetained: true });
      continue;
    }
    entry.bookingId = created?.id;
    if (durableRecovery) {
      await durableRecovery.checkpoint('ORDER_CREATED', {
        newOrderId: entry.bookingId,
      }, { action: 'ORDER_CREATED', bookingId: entry.bookingId, idempotencyKey });
    }
    return confirmAndRelease(entry);
  }
  record({ action: 'REBOOK_FLIGHT', outcome: OUTCOME.BOOKING_FAILED, authorisedBy: 'WITHIN_LIMITS',
    detail: `no authorised candidate could be booked after ${attempts.length} checks; old ticket retained`, oldTicketRetained: true });
  return result(STATUS.EXHAUSTED);
}

/**
 * Carries out the non-flight changes Phase 5 marked automatic. Kept separate
 * from the flight path because these are adjustments to an already-safe trip:
 * one failing must not put the rebooked ticket at risk.
 */
export async function executeDependentActions({
  tripId,
  decision,
  execution,
  provider,
  audit = [],
  now = () => new Date().toISOString(),
}) {
  const results = [];
  const auto = (decision?.actions ?? []).filter(
    (a) => a.autonomy === AUTONOMY.AUTO && a.action !== 'REBOOK_FLIGHT',
  );

  for (const action of auto) {
    if (![STATUS.RECOVERED, STATUS.RECOVERED_NEEDS_ATTENTION].includes(execution?.status)) {
      results.push({ ...action, outcome: 'SKIPPED', detail: 'replacement flight is not confirmed' });
      audit.push({ at: now(), tripId, action: action.action, nodeId: action.nodeId,
        outcome: 'SKIPPED', authorisedBy: 'FLIGHT_NOT_RECOVERED', detail: 'replacement flight is not confirmed' });
      continue;
    }
    const handler = provider?.adjustNode;
    if (typeof handler !== 'function') {
      results.push({ ...action, outcome: 'UNSUPPORTED' });
      audit.push({
        at: now(), tripId, action: action.action, nodeId: action.nodeId,
        outcome: 'UNSUPPORTED', authorisedBy: action.rule,
        detail: 'no provider support for dependent adjustments yet',
      });
      continue;
    }
    try {
      await handler({ tripId, nodeId: action.nodeId, action: action.action });
      results.push({ ...action, outcome: 'APPLIED' });
      audit.push({
        at: now(), tripId, action: action.action, nodeId: action.nodeId,
        outcome: 'APPLIED', authorisedBy: action.rule,
      });
    } catch (err) {
      results.push({ ...action, outcome: 'FAILED', detail: err.message });
      audit.push({
        at: now(), tripId, action: action.action, nodeId: action.nodeId,
        outcome: 'FAILED', authorisedBy: action.rule, detail: err.message,
      });
    }
  }

  return { results, audit };
}

/** One auditable line describing what actually happened. */
export function explainExecution(result) {
  if (!result) return 'nothing executed';
  switch (result.status) {
    case STATUS.RECOVERED:
      return `RECOVERED: booked ${result.option?.flightNumber ?? result.booking?.id} `
        + `after ${result.attempts.length} attempt(s); old ticket released`;
    case STATUS.RECOVERED_NEEDS_ATTENTION:
      return `RECOVERED but the old ticket could not be released — member holds two bookings`;
    case STATUS.REVIEW_REQUIRED:
      return 'NOT RECOVERED: booking outcome needs review; old ticket retained and further purchases paused';
    case STATUS.EXHAUSTED:
      return `NOT RECOVERED: ${result.attempts.length} candidate(s) failed; member keeps the original ticket`;
    default:
      return 'NOT RECOVERED: policy did not authorise an automatic rebooking';
  }
}
