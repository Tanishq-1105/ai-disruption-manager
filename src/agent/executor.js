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

import { evaluateFlightChange, DEFAULT_POLICY, DECISION, AUTONOMY } from './policy.js';
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

// Pending attempts remain attached to a recovery scope even if the next search
// would return different offer IDs. This is process-local; member recovery must
// use durable claims before it is connected to persisted trips.
const pendingByProvider = new WeakMap();
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

export async function executeRecovery({
  tripId, original, ranked = [], decision, provider, policy = DEFAULT_POLICY,
  maxAttempts = 3, audit = [], now = () => new Date().toISOString(),
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
    entry.bookingId = confirmed.id;
    if (!confirmed.option || itinerary(confirmed.option) !== itinerary(entry.option)
        || !Number.isFinite(confirmed.total?.amount)
        || confirmed.total.amount !== entry.option.price.amount
        || confirmed.total.currency !== entry.option.price.currency) {
      return review(entry, 'The confirmed order does not match the authorised fare or itinerary; review it before releasing the original.');
    }
    const booking = { ...confirmed, tripId, option: { ...entry.option, price: confirmed.total } };
    record({ action: 'CONFIRM_NEW', outcome: OUTCOME.BOOKED, authorisedBy: 'CONFIRM_BEFORE_RELEASE',
      attempt: entry.attempt, optionId: entry.option.id, bookingId: booking.id,
      idempotencyKey: entry.idempotencyKey, detail: 'independent lookup verified the authorised order, fare and itinerary' });

    if (!entry.releaseOutcome) {
      entry.releaseOutcome = OUTCOME.OLD_RELEASED;
      if (original?.bookingId) {
        try {
          const released = await provider.cancelBooking(original.bookingId);
          if (released?.status !== 'CANCELLED') throw new Error('cancellation was not confirmed');
        } catch {
          entry.releaseOutcome = OUTCOME.OLD_RELEASE_FAILED;
        }
        record({ action: 'RELEASE_OLD', bookingId: original.bookingId, outcome: entry.releaseOutcome,
          authorisedBy: 'CONFIRM_BEFORE_RELEASE', detail: entry.releaseOutcome === OUTCOME.OLD_RELEASED
            ? 'old ticket released after independent confirmation'
            : 'could not confirm release of the old ticket; member may hold two bookings' });
      }
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

  const authorised = decision?.actions?.some(action => action.action === 'REBOOK_FLIGHT'
    && action.autonomy === AUTONOMY.AUTO && action.rule === 'WITHIN_LIMITS' && !action.nodeId);
  if (!authorised) {
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
    try { prepared = await provider.prepareFlight({ option: searched }); }
    catch (error) {
      attempts.push({ attempt, optionId: searched.id, outcome: OUTCOME.PRECHECK_FAILED, detail: error.message });
      record({ action: 'REFRESH_OFFER', outcome: OUTCOME.PRECHECK_FAILED, attempt, optionId: searched.id,
        authorisedBy: 'PRE_BOOKING_CHECK', detail: error.message, oldTicketRetained: true });
      continue; // No order POST has occurred.
    }
    const option = prepared?.option;
    const evaluation = evaluateFlightChange({ option, original, policy });
    const issues = option ? viabilityIssues(option, { readyAt: original?.departureTime,
      requiredDestination: original?.destination }) : ['provider returned no refreshed itinerary'];
    if (option?.id !== searched.id) issues.push('refreshed offer does not match the selected offer');
    if (original?.origin && option?.origin !== original.origin) issues.push('refreshed flight leaves from a different airport');
    const allowed = evaluation.allowed && issues.length === 0;
    const detail = [...evaluation.violations.map(v => v.detail), ...issues].join('; ');
    record({ action: 'CHECK_REFRESHED_OFFER', attempt, optionId: searched.id,
      outcome: allowed ? 'AUTHORISED' : OUTCOME.NOT_AUTHORISED,
      authorisedBy: allowed ? 'WITHIN_LIMITS' : evaluation.violations[0]?.rule ?? 'VIABILITY',
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
      outcome: 'REQUESTED', authorisedBy: 'WITHIN_LIMITS',
      detail: `requesting ${option.flightNumber ?? option.id} at ${option.price.amount} ${option.price.currency}` });
    let created;
    try { created = await provider.bookFlight({ tripId, option, prepared, idempotencyKey }); }
    catch (error) {
      if (error.bookingOutcome !== 'NOT_CREATED') {
        return review(entry, 'Order creation outcome is unknown; reconcile this attempt before booking again.');
      }
      pending.delete(scope);
      attempts.push({ attempt, optionId: option.id, outcome: OUTCOME.BOOKING_FAILED, detail: error.message });
      record({ action: 'BOOK_NEW', attempt, optionId: option.id, idempotencyKey,
        outcome: OUTCOME.BOOKING_FAILED, authorisedBy: 'WITHIN_LIMITS', detail: error.message, oldTicketRetained: true });
      continue;
    }
    entry.bookingId = created?.id;
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
