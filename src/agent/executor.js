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
// booking fails, the old ticket is untouched and the next candidate is tried.
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

export const OUTCOME = {
  BOOKED: 'BOOKED',
  BOOKING_FAILED: 'BOOKING_FAILED',
  NOT_AUTHORISED: 'NOT_AUTHORISED',
  OLD_RELEASED: 'OLD_RELEASED',
  OLD_RELEASE_FAILED: 'OLD_RELEASE_FAILED',
  NOT_CONFIRMED: 'NOT_CONFIRMED',
};

export const STATUS = {
  RECOVERED: 'RECOVERED',
  RECOVERED_NEEDS_ATTENTION: 'RECOVERED_NEEDS_ATTENTION',
  EXHAUSTED: 'EXHAUSTED',
  NOTHING_AUTHORISED: 'NOTHING_AUTHORISED',
};

// Deterministic and stable: retrying the same attempt reuses the same key, so
// the provider returns the booking it already made rather than making another.
export function buildIdempotencyKey({ tripId, optionId, attempt }) {
  return `${tripId}:${optionId}:${attempt}`;
}

/**
 * Runs the recovery for one disrupted flight.
 *
 * `provider` is injected rather than imported so the agent core stays free of
 * any vendor, and so tests can drive failure paths without a network.
 */
export async function executeRecovery({
  tripId,
  original,
  ranked = [],
  decision,
  provider,
  policy = DEFAULT_POLICY,
  maxAttempts = 3,
  audit = [],
  now = () => new Date().toISOString(),
}) {
  const record = (entry) => {
    // Every automatic action and the rule that authorised it, per the
    // project's audit invariant.
    audit.push({ at: now(), tripId, ...entry });
    return entry;
  };

  // Phase 5 decides; Phase 6 only carries out what was authorised.
  const flightAuthorised = decision?.actions?.some((a) => a.action === 'REBOOK_FLIGHT');
  if (!flightAuthorised) {
    record({
      action: 'REBOOK_FLIGHT',
      outcome: OUTCOME.NOT_AUTHORISED,
      authorisedBy: decision?.decision ?? DECISION.ESCALATE,
      detail: 'policy did not authorise an automatic rebooking',
    });
    return {
      status: STATUS.NOTHING_AUTHORISED,
      booking: null,
      attempts: [],
      audit,
      escalations: decision?.escalations ?? [],
    };
  }

  const attempts = [];
  const candidates = ranked.slice(0, maxAttempts);

  for (let index = 0; index < candidates.length; index += 1) {
    const option = candidates[index].option ?? candidates[index];
    const attempt = index + 1;

    // Re-check every candidate, including the first. A fallback has not been
    // authorised just because its predecessor was.
    const evaluation = evaluateFlightChange({ option, original, policy });
    if (!evaluation.allowed) {
      const detail = evaluation.violations.map((v) => v.detail).join('; ');
      attempts.push({ attempt, optionId: option.id, outcome: OUTCOME.NOT_AUTHORISED, detail });
      record({
        action: 'REBOOK_FLIGHT',
        attempt,
        optionId: option.id,
        outcome: OUTCOME.NOT_AUTHORISED,
        authorisedBy: evaluation.violations[0].rule,
        detail,
      });
      continue;
    }

    const idempotencyKey = buildIdempotencyKey({ tripId, optionId: option.id, attempt });
    let booking;

    // --- step 1: book the new ticket ------------------------------------
    try {
      booking = await provider.bookFlight({ tripId, option, idempotencyKey });
    } catch (err) {
      // The old ticket has not been touched. Move to the next candidate.
      attempts.push({ attempt, optionId: option.id, outcome: OUTCOME.BOOKING_FAILED, detail: err.message });
      record({
        action: 'BOOK_NEW',
        attempt,
        optionId: option.id,
        idempotencyKey,
        outcome: OUTCOME.BOOKING_FAILED,
        authorisedBy: 'WITHIN_LIMITS',
        detail: err.message,
        oldTicketRetained: true,
      });
      continue;
    }

    // --- step 2: confirm it before anything irreversible happens ---------
    if (!booking || booking.status !== 'CONFIRMED') {
      attempts.push({ attempt, optionId: option.id, outcome: OUTCOME.NOT_CONFIRMED });
      record({
        action: 'BOOK_NEW',
        attempt,
        optionId: option.id,
        idempotencyKey,
        outcome: OUTCOME.NOT_CONFIRMED,
        authorisedBy: 'WITHIN_LIMITS',
        detail: `provider returned status ${booking?.status ?? 'none'}; old ticket retained`,
        oldTicketRetained: true,
      });
      continue;
    }

    record({
      action: 'BOOK_NEW',
      attempt,
      optionId: option.id,
      bookingId: booking.id,
      idempotencyKey,
      outcome: OUTCOME.BOOKED,
      authorisedBy: 'WITHIN_LIMITS',
      detail: `confirmed ${option.flightNumber ?? option.id}`,
    });

    // --- step 3: only now release the old ticket -------------------------
    let releaseOutcome = OUTCOME.OLD_RELEASED;
    let releaseDetail = 'old ticket released after the new one was confirmed';

    if (original?.bookingId) {
      try {
        await provider.cancelBooking(original.bookingId);
      } catch (err) {
        // Deliberately no rollback of the new booking. See the header.
        releaseOutcome = OUTCOME.OLD_RELEASE_FAILED;
        releaseDetail = `could not release the old ticket (${err.message}); member holds two bookings`;
      }
      record({
        action: 'RELEASE_OLD',
        attempt,
        bookingId: original.bookingId,
        outcome: releaseOutcome,
        authorisedBy: 'WITHIN_LIMITS',
        detail: releaseDetail,
      });
    } else {
      releaseDetail = 'no prior booking to release';
    }

    attempts.push({ attempt, optionId: option.id, outcome: OUTCOME.BOOKED, bookingId: booking.id });

    return {
      status: releaseOutcome === OUTCOME.OLD_RELEASE_FAILED
        ? STATUS.RECOVERED_NEEDS_ATTENTION
        : STATUS.RECOVERED,
      booking,
      option,
      attempts,
      audit,
      escalations: decision?.escalations ?? [],
    };
  }

  // Every candidate failed. The member still holds the original ticket.
  record({
    action: 'REBOOK_FLIGHT',
    outcome: OUTCOME.BOOKING_FAILED,
    authorisedBy: 'WITHIN_LIMITS',
    detail: `all ${attempts.length} candidate(s) failed; old ticket retained`,
    oldTicketRetained: true,
  });

  return {
    status: STATUS.EXHAUSTED,
    booking: null,
    attempts,
    audit,
    escalations: decision?.escalations ?? [],
  };
}

/**
 * Carries out the non-flight changes Phase 5 marked automatic. Kept separate
 * from the flight path because these are adjustments to an already-safe trip:
 * one failing must not put the rebooked ticket at risk.
 */
export async function executeDependentActions({
  tripId,
  decision,
  provider,
  audit = [],
  now = () => new Date().toISOString(),
}) {
  const results = [];
  const auto = (decision?.actions ?? []).filter(
    (a) => a.autonomy === AUTONOMY.AUTO && a.action !== 'REBOOK_FLIGHT',
  );

  for (const action of auto) {
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
    case STATUS.EXHAUSTED:
      return `NOT RECOVERED: ${result.attempts.length} candidate(s) failed; member keeps the original ticket`;
    default:
      return 'NOT RECOVERED: policy did not authorise an automatic rebooking';
  }
}
