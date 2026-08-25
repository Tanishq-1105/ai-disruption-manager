// Option Engine (Phase 4) — PURE. No polling, no DB, no network.
//
// Takes replacement candidates that Phase 3 says are needed, removes the ones
// that cannot work, and ranks the rest. Hands the ranking to Phase 5, which
// decides whether the agent may act alone.
//
// Two rules shape everything here:
//
// 1. Every number is deterministic and explainable. No LLM, no randomness, no
//    clock reads inside scoring. The same inputs always produce the same
//    ranking and the same reasons, because those reasons end up in the audit
//    trail justifying money spent on a member's behalf.
//
// 2. Cost is scored, never filtered. The member's cost cap governs *autonomy*,
//    not feasibility — an over-cap option is a real option that needs the
//    member's consent. Dropping it here would quietly remove a choice that is
//    theirs to make, so it is ranked like anything else and Phase 5 escalates.

import { toUtcMinutes } from '../normalize/plausibility.js';

// Higher index means a better cabin, so a downgrade is a negative delta.
export const CABIN_RANK = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];

// Everything is expressed in "equivalent minutes of inconvenience" so the
// trade-offs are comparable and legible: an extra stop costs about as much as
// arriving 45 minutes later. Exported so tests, the audit trail and any future
// tuning all read the same numbers.
export const SCORING_WEIGHTS = {
  perMinuteLate: 1,
  // Arriving early is mildly good, not proportionally good — a member does not
  // want to be rushed to the airport to save six hours of sitting at the gate.
  perMinuteEarlyCredit: 0.25,
  maxEarlyCredit: 120,
  perExtraStop: 45,
  perCabinDowngrade: 120,
  // A downgrade is a real cost; an upgrade is a windfall we do not chase.
  perCabinUpgradeCredit: 0,
  differentAirline: 30,
  // One equivalent minute per two currency units of extra fare.
  perCurrencyUnitExtra: 0.5,
  perCurrencyUnitSaved: 0.25,
};

function cabinRank(cabin) {
  const index = CABIN_RANK.indexOf(String(cabin ?? '').toUpperCase());
  return index === -1 ? null : index;
}

// An option's arrival has to be compared in UTC — a nearby-airport alternate
// can land in a different timezone than the original, and local wall clock
// would make it look hours better or worse than it is.
export function arrivalUtcMinutes(option) {
  const last = option?.segments?.[option.segments.length - 1];
  return toUtcMinutes(option?.arrivalTime, last?.arrivalOffsetHours);
}

export function departureUtcMinutes(option) {
  const first = option?.segments?.[0];
  return toUtcMinutes(option?.departureTime, first?.departureOffsetHours);
}

/**
 * Hard feasibility. These are not preferences — an option that fails one of
 * these cannot be taken at all, so it is removed rather than penalised.
 */
export function viabilityIssues(option, context = {}) {
  const issues = [];
  const departure = departureUtcMinutes(option);
  const arrival = arrivalUtcMinutes(option);

  if (departure === null || arrival === null) {
    issues.push('option has unusable departure or arrival time');
    return issues;
  }

  // The member has to physically be able to make the flight.
  const readyAt = toUtcMinutes(context.readyAt, context.readyAtOffsetHours);
  if (readyAt !== null && departure < readyAt) {
    issues.push(`departs ${readyAt - departure}min before the member can reach the airport`);
  }

  // A replacement that lands after the reason for travelling has passed is not
  // a replacement. This is what makes a COMMITMENT node bite.
  const mustArriveBy = toUtcMinutes(context.mustArriveBy, context.mustArriveByOffsetHours);
  if (mustArriveBy !== null && arrival > mustArriveBy) {
    issues.push(`arrives ${arrival - mustArriveBy}min after the latest useful arrival`);
  }

  if (context.requiredDestination && option.destination !== context.requiredDestination) {
    // Callers wanting nearby-airport alternates pass acceptableDestinations
    // instead; this is the strict single-airport check.
    issues.push(`lands at ${option.destination}, not ${context.requiredDestination}`);
  }

  if (Array.isArray(context.acceptableDestinations)
      && context.acceptableDestinations.length > 0
      && !context.acceptableDestinations.includes(option.destination)) {
    issues.push(`lands at ${option.destination}, outside the acceptable airports`);
  }

  if (Number.isFinite(option.seatsRemaining) && option.seatsRemaining <= 0) {
    issues.push('no seats remaining');
  }

  return issues;
}

/**
 * Scores one option against the disrupted original. Lower is better: the score
 * is total inconvenience, so zero means "as good as what the member already
 * had". The breakdown is the audit record — every point is attributable.
 */
export function scoreOption(option, context = {}) {
  const weights = { ...SCORING_WEIGHTS, ...(context.weights ?? {}) };
  const original = context.original ?? {};
  const breakdown = [];

  const add = (factor, points, detail) => {
    if (points !== 0) breakdown.push({ factor, points: round(points), detail });
  };

  // --- arrival time, usually the dominant term -------------------------
  const optionArrival = arrivalUtcMinutes(option);
  const originalArrival = toUtcMinutes(original.arrivalTime, original.arrivalOffsetHours);
  if (optionArrival !== null && originalArrival !== null) {
    const delta = optionArrival - originalArrival;
    if (delta > 0) {
      add('arrival', delta * weights.perMinuteLate, `${delta}min later than the original`);
    } else if (delta < 0) {
      const credit = Math.min(-delta * weights.perMinuteEarlyCredit, weights.maxEarlyCredit);
      add('arrival', -credit, `${-delta}min earlier than the original`);
    }
  } else {
    breakdown.push({ factor: 'arrival', points: 0, detail: 'no comparable arrival time' });
  }

  // --- stops ------------------------------------------------------------
  if (Number.isFinite(option.stops) && Number.isFinite(original.stops)) {
    const extra = option.stops - original.stops;
    if (extra !== 0) {
      add('stops', extra * weights.perExtraStop,
        extra > 0 ? `${extra} more stop(s)` : `${-extra} fewer stop(s)`);
    }
  }

  // --- cabin ------------------------------------------------------------
  const optionCabin = cabinRank(option.cabin);
  const originalCabin = cabinRank(original.cabin);
  if (optionCabin !== null && originalCabin !== null && optionCabin !== originalCabin) {
    const delta = originalCabin - optionCabin; // positive means a downgrade
    if (delta > 0) {
      add('cabin', delta * weights.perCabinDowngrade, `downgraded ${delta} cabin class(es)`);
    } else {
      add('cabin', delta * weights.perCabinUpgradeCredit, `upgraded ${-delta} cabin class(es)`);
    }
  }

  // --- airline ----------------------------------------------------------
  if (original.airline && option.airline && option.airline !== original.airline) {
    add('airline', weights.differentAirline, `switches ${original.airline} to ${option.airline}`);
  }

  // --- price ------------------------------------------------------------
  const optionPrice = option.price?.amount;
  const originalPrice = original.price?.amount;
  if (Number.isFinite(optionPrice) && Number.isFinite(originalPrice)) {
    const currency = option.price?.currency ?? '';
    const delta = optionPrice - originalPrice;
    if (delta > 0) {
      add('price', delta * weights.perCurrencyUnitExtra, `${round(delta)} ${currency} more`);
    } else if (delta < 0) {
      add('price', delta * weights.perCurrencyUnitSaved, `${round(-delta)} ${currency} less`);
    }
  } else if (!Number.isFinite(optionPrice)) {
    // Never let an unpriced option win by default just because it scored no
    // price penalty — say so, loudly, in the record.
    breakdown.push({ factor: 'price', points: 0, detail: 'option has no price; not comparable' });
  }

  const total = round(breakdown.reduce((sum, item) => sum + item.points, 0));
  return { total, breakdown };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Filters, scores and orders candidates. Returns the rejects too — the agent
 * has to be able to say what it considered and discarded, not just what it
 * picked.
 */
// Providers return the same physical flight many times over, once per fare
// class — Sabre's normalizer notes it, and a live Duffel search returned the
// same AS0227 three times in the top three.
//
// That matters beyond tidiness: the executor treats each ranked entry as a
// separate retry, so three copies of one flight look like three chances and are
// really one. When that flight becomes unavailable, every "fallback" fails for
// the identical reason. Collapsing them keeps the retry budget meaningful.
function dedupeByFlight(scored) {
  const seen = new Set();
  const unique = [];
  for (const entry of scored) {
    const o = entry.option;
    const key = `${o.flightNumber ?? o.id}|${o.departureTime ?? ''}|${o.stops ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

export function rankOptions(options = [], context = {}) {
  const viable = [];
  const rejected = [];

  for (const option of options) {
    const issues = viabilityIssues(option, context);
    if (issues.length > 0) rejected.push({ option, issues });
    else viable.push(option);
  }

  const ranked = viable
    .map((option) => ({ option, ...scoreOption(option, context) }))
    // Ties are broken on cheaper, then earlier, then id, so the ordering is
    // total and never depends on the order the provider happened to return.
    .sort((a, b) => (
      a.total - b.total
      || (a.option.price?.amount ?? Infinity) - (b.option.price?.amount ?? Infinity)
      || (departureUtcMinutes(a.option) ?? Infinity) - (departureUtcMinutes(b.option) ?? Infinity)
      || String(a.option.id).localeCompare(String(b.option.id))
    ));

  // Collapse after sorting so the survivor of each duplicate group is its
  // best-scoring member.
  const unique = context.keepDuplicateFlights ? ranked : dedupeByFlight(ranked);

  return { ranked: unique, rejected, best: unique[0] ?? null, duplicatesCollapsed: ranked.length - unique.length };
}

/** One human-readable line for the notification and the audit trail. */
export function explainChoice(scored) {
  if (!scored) return 'no viable option';
  const reasons = scored.breakdown
    .filter((item) => item.detail)
    .map((item) => item.detail)
    .join('; ');
  return `${scored.option.flightNumber ?? scored.option.id} scored ${scored.total} (${reasons || 'identical to the original'})`;
}
