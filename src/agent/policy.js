// Policy Engine (Phase 5) — PURE. No polling, no DB, no network, no LLM.
//
// Takes the option Phase 4 ranked first plus the impact list from Phase 3, and
// answers one question: how much of this may the agent do on its own?
//
//   ACT      every change is small and reversible - do it all, tell the member after
//   SPLIT    do the safe part now, ask about the risky part
//   ESCALATE nothing here is the agent's to decide alone
//
// This is the trust boundary of the whole product, so three rules are absolute:
//
// 1. Every decision is deterministic and attributable. Each verdict names the
//    rule that produced it, because that pairing is what the audit trail has to
//    record to justify money spent on a member's behalf.
// 2. The engine never widens its own authority. Anything it cannot evaluate -
//    an unknown node type, a fare in a currency it cannot compare, a missing
//    price - escalates. Silence is never consent.
// 3. It decides; it does not act. Phase 6 executes, and only what it is given.

// Extra spend the agent may authorise without asking, plus the comfort limits
// that separate a routine reroute from something the member should see.
import { toUtcMinutes } from '../normalize/plausibility.js';
import { createHash } from 'node:crypto';

export const POLICY_VERSION = 'tripshield-recovery-policy-v1';
export const DEFAULT_POLICY = {
  // Measured as spend ABOVE the original fare - the incremental cost the agent
  // is committing on the member's behalf, not the absolute ticket price.
  costCap: { amount: 300, currency: 'USD' },
  maxArrivalDelayHours: 12,
  allowCabinDowngrade: false,
  allowOvernight: false,
  sameDayOnly: true,
};

export const DECISION = { ACT: 'ACT', SPLIT: 'SPLIT', ESCALATE: 'ESCALATE' };
export const AUTONOMY = { AUTO: 'AUTO', ESCALATE: 'ESCALATE' };

const MINUTES_PER_HOUR = 60;

function hasUsableTime(value, offsetHours) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return false;
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) || Number.isFinite(offsetHours);
}

export function localDateAtOffset(value, offsetHours) {
  if (!hasUsableTime(value, offsetHours)) return null;
  const suffix = /([+-])(\d{2}):?(\d{2})$/i.exec(value);
  if (!Number.isFinite(offsetHours) && !suffix) return null;
  const offset = Number.isFinite(offsetHours) ? offsetHours * 60
    : (suffix[1] === '-' ? -1 : 1) * (Number(suffix[2]) * 60 + Number(suffix[3]));
  const instant = toUtcMinutes(value, offsetHours);
  if (instant === null) return null;
  return new Date((instant + offset) * 60_000).toISOString().slice(0, 10);
}

export function buildApprovalBinding({ option, policy, quoteVersion }) {
  const details = {
    policyVersion: POLICY_VERSION,
    quoteVersion: quoteVersion ?? option?.id ?? null,
    optionId: option?.id ?? null,
    offerId: option?.offerId ?? option?.id ?? null,
    expiresAt: option?.expiresAt ?? null,
    price: option?.price ?? null,
    origin: option?.origin ?? null,
    destination: option?.destination ?? null,
    departureTime: option?.departureTime ?? null,
    arrivalTime: option?.arrivalTime ?? null,
    cabin: option?.cabin ?? null,
    refundable: option?.refundable ?? null,
    flightNumber: option?.flightNumber ?? null,
    stops: option?.stops ?? null,
    segments: option?.segments ?? null,
    policy,
  };
  return {
    ...details,
    fingerprint: createHash('sha256').update(JSON.stringify(details)).digest('hex'),
  };
}

/**
 * Checks the proposed flight change against the member's autonomy limits.
 * Returns every violation rather than the first, so the member sees the whole
 * reason a change needed their consent.
 */
export function evaluateFlightChange({ option, original, policy = DEFAULT_POLICY }) {
  const violations = [];
  const checks = [];

  const pass = (rule, detail) => checks.push({ rule, passed: true, detail });
  const fail = (rule, detail) => {
    checks.push({ rule, passed: false, detail });
    violations.push({ rule, detail });
  };

  // --- cost -------------------------------------------------------------
  const optionPrice = option?.price?.amount;
  const originalPrice = original?.price?.amount;
  const optionCurrency = option?.price?.currency;
  const originalCurrency = original?.price?.currency;

  if (!Number.isFinite(optionPrice) || optionPrice < 0
      || !Number.isFinite(originalPrice) || originalPrice < 0) {
    // An unpriced change is an unbounded commitment. Never automatic.
    fail('COST_CAP', 'fare is missing, so the extra spend cannot be bounded');
  } else if (!/^[A-Z]{3}$/.test(optionCurrency ?? '')
      || !/^[A-Z]{3}$/.test(originalCurrency ?? '')) {
    fail('COST_CAP', 'fare currency is missing or invalid');
  } else if (optionCurrency !== originalCurrency) {
    // Converting currencies would need a rate, and a rate is a judgement call
    // the member did not delegate.
    fail('COST_CAP', `cannot compare ${optionCurrency} against ${originalCurrency} without a rate`);
  } else {
    const extra = optionPrice - originalPrice;
    const cap = policy.costCap?.amount;
    if (!Number.isFinite(cap) || cap < 0
        || !/^[A-Z]{3}$/.test(policy.costCap?.currency ?? '')) {
      fail('COST_CAP', 'member cost cap is missing or invalid');
    } else if (policy.costCap.currency !== optionCurrency) {
      fail('COST_CAP', `cap is in ${policy.costCap.currency}, fare is in ${optionCurrency}`);
    } else if (extra > cap) {
      fail('COST_CAP', `${round(extra)} ${optionCurrency} above the original exceeds the ${cap} cap`);
    } else {
      pass('COST_CAP', extra > 0
        ? `${round(extra)} ${optionCurrency} extra, within the ${cap} cap`
        : `no extra cost`);
    }
  }

  // --- arrival delay ----------------------------------------------------
  const delayMinutes = arrivalDelayMinutes(option, original);
  if (delayMinutes === null) {
    fail('ARRIVAL_WINDOW', 'arrival times are not comparable');
  } else {
    const hours = policy.maxArrivalDelayHours;
    if (!Number.isFinite(hours) || hours < 0) {
      fail('ARRIVAL_WINDOW', 'maximum arrival delay policy is missing or invalid');
    } else if (delayMinutes > hours * MINUTES_PER_HOUR) {
      fail('ARRIVAL_WINDOW', `arrives ${round(delayMinutes / 60)}h later, beyond the ${policy.maxArrivalDelayHours}h window`);
    } else {
      pass('ARRIVAL_WINDOW', delayMinutes > 0
        ? `arrives ${round(delayMinutes / 60)}h later, inside the ${policy.maxArrivalDelayHours}h window`
        : 'arrives no later than the original');
    }
  }

  // --- same day / overnight --------------------------------------------
  const originalArrivalOffset = original?.segments?.at(-1)?.arrivalOffsetHours ?? original?.arrivalOffsetHours;
  const optionArrivalOffset = option?.segments?.at(-1)?.arrivalOffsetHours ?? option?.arrivalOffsetHours;
  const originalDay = localDateAtOffset(original?.arrivalTime, originalArrivalOffset);
  const optionDay = localDateAtOffset(option?.arrivalTime, optionArrivalOffset);
  if (!hasUsableTime(original?.departureTime,
    original?.segments?.[0]?.departureOffsetHours ?? original?.departureOffsetHours)
      || !hasUsableTime(option?.departureTime,
        option?.segments?.[0]?.departureOffsetHours ?? option?.departureOffsetHours)
      || !originalDay || !optionDay) {
    fail('SCHEDULE', 'departure and destination-local arrival schedules with usable time zones are required');
  } else if (typeof policy.sameDayOnly !== 'boolean') {
    fail('SCHEDULE', 'same-day recovery policy is missing or invalid');
  } else {
    pass('SCHEDULE', 'departure and destination-local arrival schedules are valid');
    if (policy.sameDayOnly) {
      if (optionDay !== originalDay) {
        if (policy.allowOvernight) pass('OVERNIGHT', `overnight arrival permitted by policy (${optionDay})`);
        else fail('OVERNIGHT', `arrives on ${optionDay}, not ${originalDay}`);
      } else {
        pass('SAME_DAY', `arrives the same day (${optionDay})`);
      }
    }
  }

  if (option?.origin !== original?.origin || option?.destination !== original?.destination
      || !option?.origin || !option?.destination) {
    fail('ITINERARY', 'replacement must preserve the original origin and destination');
  } else {
    pass('ITINERARY', `preserves ${original.origin}-${original.destination}`);
  }

  // --- cabin ------------------------------------------------------------
  const optionCabin = String(option?.cabin ?? '').toUpperCase();
  const originalCabin = String(original?.cabin ?? '').toUpperCase();
  if (!CABIN_ORDER.includes(optionCabin) || !CABIN_ORDER.includes(originalCabin)) {
    fail('CABIN', 'original and replacement cabin classes must both be known');
  }
  const downgraded = isCabinDowngrade(optionCabin, originalCabin);
  if (downgraded && !policy.allowCabinDowngrade) {
    fail('CABIN', `downgrades ${original.cabin} to ${option.cabin}`);
  } else if (downgraded) {
    pass('CABIN', `downgrade permitted by policy`);
  } else if (CABIN_ORDER.includes(optionCabin) && CABIN_ORDER.includes(originalCabin)) {
    pass('CABIN', 'cabin maintained or better');
  }

  if (typeof option?.refundable !== 'boolean' || typeof original?.refundable !== 'boolean') {
    fail('REFUNDABILITY', 'refund conditions for the original and replacement fares must be verified');
  } else if (!option.refundable || !original.refundable) {
    pass('REFUNDABILITY_KNOWN', 'refund conditions are known');
    fail('NON_REFUNDABLE', 'one or both fares are non-refundable');
  } else {
    pass('REFUNDABILITY_KNOWN', 'refund conditions are known');
    pass('REFUNDABILITY', 'original and replacement fares are verified refundable');
  }

  return { allowed: violations.length === 0, violations, checks };
}

// Shares the normalizer's parsing so both halves of the agent agree on what a
// timestamp means — a nearby-airport alternate can land in a different
// timezone than the original, and the simulator and Sabre write ISO
// differently.
export function arrivalDelayMinutes(option, original) {
  const a = toUtcMinutes(option?.arrivalTime, option?.segments?.at(-1)?.arrivalOffsetHours ?? option?.arrivalOffsetHours);
  const b = toUtcMinutes(original?.arrivalTime, original?.arrivalOffsetHours);
  if (a === null || b === null) return null;
  return a - b;
}

const CABIN_ORDER = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];
function isCabinDowngrade(optionCabin, originalCabin) {
  const a = CABIN_ORDER.indexOf(String(optionCabin ?? '').toUpperCase());
  const b = CABIN_ORDER.indexOf(String(originalCabin ?? '').toUpperCase());
  if (a === -1 || b === -1) return false;
  return a < b;
}

/**
 * Decides autonomy for one downstream impact from Phase 3. Impacts Phase 3
 * already marked ESCALATE stay escalated — this engine may narrow authority,
 * never widen it.
 */
export function classifyImpact(impact, policy = DEFAULT_POLICY, node = null) {
  const escalate = (reason) => ({ ...impact, autonomy: AUTONOMY.ESCALATE, rule: 'IMPACT', reason });

  if (impact.action === 'ESCALATE') {
    return escalate(impact.reason ?? 'flagged by impact analysis');
  }

  // An irreversible change is never the agent's to make quietly, whatever its
  // type says.
  if (node && node.reversible === false) {
    return escalate('the booking is not reversible');
  }

  switch (impact.action) {
    case 'REBOOK_FLIGHT':
      return { ...impact, autonomy: AUTONOMY.AUTO, rule: 'REBOOK_FLIGHT' };
    case 'SHIFT_HOTEL':
      // Phase 3 only emits SHIFT_HOTEL for refundable stays, but re-check
      // rather than trust: a non-refundable shift costs the member money.
      if (node && node.refundable === false) return escalate('non-refundable hotel');
      if (!policy.allowOvernight && node?.requiresExtraNight) {
        return escalate('shift adds an unplanned night');
      }
      return { ...impact, autonomy: AUTONOMY.AUTO, rule: 'SHIFT_HOTEL' };
    case 'RETIME_GROUND':
      return { ...impact, autonomy: AUTONOMY.AUTO, rule: 'RETIME_GROUND' };
    default:
      // REVIEW, or anything this engine does not recognise. Unknown is not safe.
      return escalate(`no policy rule covers "${impact.action}"`);
  }
}

/**
 * The whole Phase 5 verdict: what the agent may do now, what it must ask about,
 * and why for each.
 */
export function decide({ option, original, impacts = [], policy = DEFAULT_POLICY, nodesById = {} }) {
  const actions = [];
  const escalations = [];

  // --- the replacement flight itself ------------------------------------
  if (!option) {
    escalations.push({
      target: 'FLIGHT',
      action: 'REBOOK_FLIGHT',
      autonomy: AUTONOMY.ESCALATE,
      rule: 'NO_OPTION',
      reason: 'no viable replacement was found',
    });
  } else {
    const evaluation = evaluateFlightChange({ option, original, policy });
    const entry = {
      target: 'FLIGHT',
      action: 'REBOOK_FLIGHT',
      optionId: option.id,
      flightNumber: option.flightNumber,
      checks: evaluation.checks,
    };
    if (evaluation.allowed) {
      actions.push({ ...entry, autonomy: AUTONOMY.AUTO, rule: 'WITHIN_LIMITS' });
    } else {
      escalations.push({
        ...entry,
        autonomy: AUTONOMY.ESCALATE,
        rule: evaluation.violations[0].rule,
        reason: evaluation.violations.map((v) => v.detail).join('; '),
        violations: evaluation.violations,
      });
    }
  }

  // --- everything the disruption dragged with it -------------------------
  for (const impact of impacts) {
    const classified = classifyImpact(impact, policy, nodesById[impact.nodeId] ?? null);
    if (classified.autonomy === AUTONOMY.AUTO) actions.push({ target: impact.type, ...classified });
    else escalations.push({ target: impact.type, ...classified });
  }

  let decision;
  if (escalations.length === 0) decision = DECISION.ACT;
  else if (actions.length === 0) decision = DECISION.ESCALATE;
  else decision = DECISION.SPLIT;

  return { decision, actions, escalations, policy, policyVersion: POLICY_VERSION };
}

/** One auditable line describing the verdict. */
export function explainDecision(result) {
  if (!result) return 'no decision';
  const { decision, actions, escalations } = result;
  if (decision === DECISION.ACT) {
    return `ACT: handling ${actions.length} change(s) automatically`;
  }
  if (decision === DECISION.ESCALATE) {
    return `ESCALATE: ${escalations.map((e) => e.reason).join('; ')}`;
  }
  return `SPLIT: acting on ${actions.length} change(s), asking about ${escalations.length} `
    + `(${escalations.map((e) => e.reason).join('; ')})`;
}

function round(n) {
  return Math.round(n * 100) / 100;
}
