// Recovery orchestrator — joins the four agent phases into the loop the
// product promises:
//
//   Notice (2) -> Assess (3) -> Pick (4) -> Policy (5) -> Book safely (6)
//
// This is the only place the phases meet. It is deliberately thin: it owns
// sequencing and nothing else, so every decision it reports was made by a pure
// module that can be tested without it.
//
// It is not pure — it searches and it books — so the provider and the search
// function are injected. The agent core still never imports a vendor.

import { detectDisruptions } from './detection.js';
import { analyseImpact } from './impact.js';
import { rankOptions, explainChoice } from './options.js';
import { decide, explainDecision, DEFAULT_POLICY } from './policy.js';
import { executeRecovery, executeDependentActions, explainExecution, getPendingRecovery, completeRecovery } from './executor.js';
import { composeMemberMessage } from './notifier.js';

// Serialise requests for the same provider/trip. A queued request reads the
// repaired graph after its predecessor finishes, instead of buying another
// flight from a concurrent search. Other trips can still recover independently.
const recoveryQueues = new WeakMap();

/**
 * Runs one full recovery pass over a trip.
 *
 * `searchReplacements({ origin, destination, departureDate })` returns already
 * normalized, already plausibility-filtered candidates. Keeping it injected
 * means this module works the same against Sabre, a mock, or a future provider.
 */
export async function runRecovery(args) {
  const { provider, tripId } = args;
  let queue = recoveryQueues.get(provider);
  if (!queue) {
    queue = new Map();
    recoveryQueues.set(provider, queue);
  }
  const previous = queue.get(tripId);
  const operation = previous
    ? previous.catch(() => {}).then(() => runRecoveryOnce(args))
    : runRecoveryOnce(args);
  queue.set(tripId, operation);
  try {
    return await operation;
  } finally {
    if (queue.get(tripId) === operation) queue.delete(tripId);
  }
}

async function runRecoveryOnce({
  tripId,
  provider,
  searchReplacements,
  policy = DEFAULT_POLICY,
  maxAttempts = 3,
  now = () => new Date().toISOString(),
}) {
  const audit = [];
  const trip = provider.getTrip(tripId);

  // --- Phase 2: notice --------------------------------------------------
  const events = detectDisruptions(trip);
  if (events.length === 0) {
    return { tripId, events: [], recoveries: [], audit, summary: 'no disruption detected' };
  }

  const recoveries = [];

  for (const event of events) {
    // Only a cancellation has a flight to replace. A connection at risk is
    // reported so the panel can show it, but rebooking a leg that has not
    // actually failed is a bigger decision than this loop should take alone.
    if (event.type !== 'CANCELLATION') {
      recoveries.push({ event, skipped: 'connection risk is reported, not auto-rebooked' });
      continue;
    }

    const node = trip.nodes.find((n) => n.id === event.nodeId);
    if (!node || node.type !== 'FLIGHT') {
      recoveries.push({ event, skipped: 'cancelled node is not a flight' });
      continue;
    }

    // --- Phase 3: assess ------------------------------------------------
    const impacts = analyseImpact(trip, event);
    const nodesById = Object.fromEntries(trip.nodes.map((n) => [n.id, n]));

    // --- Phase 4: pick --------------------------------------------------
    const departureDate = String(node.scheduledDeparture).slice(0, 10);
    const pending = getPendingRecovery({ provider, scope: node });
    const candidates = pending ? [pending.option] : await searchReplacements({
      origin: node.origin,
      destination: node.destination,
      departureDate,
    });

    const original = {
      nodeId: node.id,
      origin: node.origin,
      destination: node.destination,
      departureTime: node.scheduledDeparture,
      bookingId: node.bookingId,
      airline: node.airline,
      cabin: node.cabin,
      arrivalTime: node.scheduledArrival,
      stops: node.stops ?? 0,
      price: node.price,
    };

    const { ranked, rejected } = rankOptions(candidates, {
      original,
      // The member cannot board something that already left.
      readyAt: node.scheduledDeparture,
    });

    // --- Phase 5: policy ------------------------------------------------
    const decision = decide({
      option: ranked[0]?.option ?? null,
      original,
      impacts,
      policy,
      nodesById,
    });

    // --- Phase 6: book safely -------------------------------------------
    const execution = await executeRecovery({
      tripId,
      original,
      ranked,
      decision,
      provider,
      policy,
      maxAttempts,
      audit,
      now,
      scope: node,
    });

    // Also attach the replacement when releasing the old ticket failed: the
    // member still owns the confirmed new ticket and must not buy another one.
    if (execution.booking?.status === 'CONFIRMED') {
      await provider.replaceFlight({ tripId, nodeId: node.id, booking: execution.booking });
      audit.push({
        at: now(), tripId, nodeId: node.id,
        action: 'UPDATE_FLIGHT', outcome: 'APPLIED', authorisedBy: 'WITHIN_LIMITS',
        bookingId: execution.booking.id,
        detail: 'trip flight updated to the confirmed replacement',
      });
      completeRecovery({ provider, scope: node });
    }

    const dependents = await executeDependentActions({ tripId, decision, execution, provider, audit, now });

    recoveries.push({
      event,
      impacts,
      candidateCount: candidates.length,
      rejectedCount: rejected.length,
      ranked: ranked.slice(0, 5).map((r) => ({
        optionId: r.option.id,
        flightNumber: r.option.flightNumber,
        departureTime: r.option.departureTime,
        arrivalTime: r.option.arrivalTime,
        stops: r.option.stops,
        price: r.option.price,
        score: r.total,
        breakdown: r.breakdown,
      })),
      choice: explainChoice(ranked[0] ?? null),
      decision,
      decisionSummary: explainDecision(decision),
      execution: {
        status: execution.status,
        bookingId: execution.booking?.id ?? null,
        pendingBookingId: execution.pendingBookingId ?? null,
        detail: execution.detail ?? null,
        // The option that was actually booked, which is NOT necessarily the
        // top-ranked one: earlier candidates can fail and be fallen through.
        // The member's message reads from this, never from the ranking.
        option: execution.option ?? null,
        attempts: execution.attempts,
        summary: explainExecution(execution),
      },
      dependents: dependents.results,
    });

    // Compose the member's message from the result that just happened, so what
    // they read and what the audit trail records can never disagree.
    recoveries[recoveries.length - 1].message = composeMemberMessage(
      recoveries[recoveries.length - 1],
    );
  }

  return {
    tripId,
    events,
    recoveries,
    audit,
    summary: recoveries.map((r) => r.execution?.summary ?? r.skipped).join(' | '),
  };
}
