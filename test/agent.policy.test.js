import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decide,
  evaluateFlightChange,
  classifyImpact,
  explainDecision,
  arrivalDelayMinutes,
  DEFAULT_POLICY,
  DECISION,
  AUTONOMY,
} from '../src/agent/policy.js';

const ORIGINAL = {
  airline: 'DL',
  cabin: 'ECONOMY',
  arrivalTime: '2026-09-23T10:00:00',
  arrivalOffsetHours: -7,
  price: { amount: 200, currency: 'USD' },
};

function option(overrides = {}) {
  return {
    id: 'opt-1',
    flightNumber: 'DL767',
    airline: 'DL',
    cabin: 'ECONOMY',
    arrivalTime: '2026-09-23T12:00:00',
    arrivalOffsetHours: -7,
    price: { amount: 260, currency: 'USD' },
    ...overrides,
  };
}

// --- the flight change itself -----------------------------------------

test('a small, same-day, in-cap change is allowed', () => {
  const { allowed, violations } = evaluateFlightChange({ option: option(), original: ORIGINAL });
  assert.equal(allowed, true);
  assert.deepEqual(violations, []);
});

test('exceeding the cost cap blocks autonomy', () => {
  const { allowed, violations } = evaluateFlightChange({
    option: option({ price: { amount: 700, currency: 'USD' } }),
    original: ORIGINAL,
  });
  assert.equal(allowed, false);
  assert.equal(violations[0].rule, 'COST_CAP');
  assert.match(violations[0].detail, /exceeds the 300 cap/);
});

test('the cap measures extra spend, not the absolute fare', () => {
  // A 900 fare replacing an 800 one is only 100 of new commitment.
  const { allowed } = evaluateFlightChange({
    option: option({ price: { amount: 900, currency: 'USD' } }),
    original: { ...ORIGINAL, price: { amount: 800, currency: 'USD' } },
  });
  assert.equal(allowed, true);
});

test('a cheaper replacement is always within cap', () => {
  const { allowed } = evaluateFlightChange({
    option: option({ price: { amount: 50, currency: 'USD' } }),
    original: ORIGINAL,
  });
  assert.equal(allowed, true);
});

// Rule 2: the engine never widens its own authority.
test('a missing fare escalates rather than being treated as free', () => {
  const { allowed, violations } = evaluateFlightChange({
    option: option({ price: undefined }),
    original: ORIGINAL,
  });
  assert.equal(allowed, false);
  assert.match(violations[0].detail, /cannot be bounded/);
});

test('mismatched currencies escalate rather than guessing a rate', () => {
  const { allowed, violations } = evaluateFlightChange({
    option: option({ price: { amount: 210, currency: 'EUR' } }),
    original: ORIGINAL,
  });
  assert.equal(allowed, false);
  assert.match(violations[0].detail, /without a rate/);
});

test('arriving beyond the delay window escalates', () => {
  const { allowed, violations } = evaluateFlightChange({
    option: option({ arrivalTime: '2026-09-23T23:59:00' }),
    original: ORIGINAL,
  });
  assert.equal(allowed, false);
  assert.equal(violations[0].rule, 'ARRIVAL_WINDOW');
});

test('a next-day arrival escalates as an overnight', () => {
  const { allowed, violations } = evaluateFlightChange({
    option: option({ arrivalTime: '2026-09-24T08:00:00' }),
    original: ORIGINAL,
  });
  assert.equal(allowed, false);
  assert.ok(violations.some((v) => v.rule === 'OVERNIGHT' || v.rule === 'ARRIVAL_WINDOW'));
});

test('a cabin downgrade escalates unless the member permitted it', () => {
  const business = { ...ORIGINAL, cabin: 'BUSINESS' };
  const downgrade = option({ cabin: 'ECONOMY' });

  const strict = evaluateFlightChange({ option: downgrade, original: business });
  assert.equal(strict.allowed, false);
  assert.equal(strict.violations[0].rule, 'CABIN');

  const permissive = evaluateFlightChange({
    option: downgrade,
    original: business,
    policy: { ...DEFAULT_POLICY, allowCabinDowngrade: true },
  });
  assert.equal(permissive.allowed, true);
});

test('an upgrade is never treated as a violation', () => {
  const { allowed } = evaluateFlightChange({
    option: option({ cabin: 'BUSINESS' }),
    original: ORIGINAL,
  });
  assert.equal(allowed, true);
});

test('all violations are reported, not just the first', () => {
  const { violations } = evaluateFlightChange({
    option: option({ price: { amount: 2000, currency: 'USD' }, arrivalTime: '2026-09-25T20:00:00' }),
    original: ORIGINAL,
  });
  assert.ok(violations.length >= 2, 'the member should see every reason');
});

test('every check records the rule that produced it', () => {
  const { checks } = evaluateFlightChange({ option: option(), original: ORIGINAL });
  for (const c of checks) {
    assert.ok(c.rule, 'each check names its rule');
    assert.ok(c.detail, 'each check explains itself');
  }
});

test('arrival delay accounts for timezone offsets', () => {
  // Same instant, expressed one hour further east.
  const same = { arrivalTime: '2026-09-23T11:00:00', arrivalOffsetHours: -6 };
  assert.equal(arrivalDelayMinutes(same, ORIGINAL), 0);
});

// --- downstream impacts ------------------------------------------------

test('a refundable hotel shift is automatic, a non-refundable one is not', () => {
  const impact = { nodeId: 'hotel', type: 'HOTEL', action: 'SHIFT_HOTEL' };
  assert.equal(classifyImpact(impact, DEFAULT_POLICY, { refundable: true }).autonomy, AUTONOMY.AUTO);
  assert.equal(classifyImpact(impact, DEFAULT_POLICY, { refundable: false }).autonomy, AUTONOMY.ESCALATE);
});

test('an impact Phase 3 already escalated stays escalated', () => {
  const impact = { nodeId: 'meeting', type: 'COMMITMENT', action: 'ESCALATE', reason: 'commitment at risk' };
  const result = classifyImpact(impact, DEFAULT_POLICY, null);
  assert.equal(result.autonomy, AUTONOMY.ESCALATE);
  assert.match(result.reason, /commitment at risk/);
});

test('an irreversible booking escalates whatever its type says', () => {
  const impact = { nodeId: 'ground', type: 'GROUND', action: 'RETIME_GROUND' };
  const result = classifyImpact(impact, DEFAULT_POLICY, { reversible: false });
  assert.equal(result.autonomy, AUTONOMY.ESCALATE);
  assert.match(result.reason, /not reversible/);
});

test('an unrecognised action escalates rather than passing silently', () => {
  const result = classifyImpact({ nodeId: 'x', type: 'MYSTERY', action: 'REVIEW' }, DEFAULT_POLICY);
  assert.equal(result.autonomy, AUTONOMY.ESCALATE);
  assert.match(result.reason, /no policy rule covers/);
});

test('a hotel shift needing an extra night escalates', () => {
  const impact = { nodeId: 'hotel', type: 'HOTEL', action: 'SHIFT_HOTEL' };
  const result = classifyImpact(impact, DEFAULT_POLICY, { refundable: true, requiresExtraNight: true });
  assert.equal(result.autonomy, AUTONOMY.ESCALATE);
  assert.match(result.reason, /unplanned night/);
});

// --- the whole verdict --------------------------------------------------

test('ACT when the flight and every dependent change are safe', () => {
  const result = decide({
    option: option(),
    original: ORIGINAL,
    impacts: [
      { nodeId: 'hotel', type: 'HOTEL', action: 'SHIFT_HOTEL' },
      { nodeId: 'car', type: 'GROUND', action: 'RETIME_GROUND' },
    ],
    nodesById: { hotel: { refundable: true }, car: { reversible: true } },
  });
  assert.equal(result.decision, DECISION.ACT);
  assert.equal(result.escalations.length, 0);
  assert.equal(result.actions.length, 3);
});

// The headline behaviour from the product vision.
test('SPLIT acts on the flight and escalates only the non-refundable hotel', () => {
  const result = decide({
    option: option(),
    original: ORIGINAL,
    impacts: [
      { nodeId: 'hotel', type: 'HOTEL', action: 'ESCALATE', reason: 'non-refundable hotel change' },
      { nodeId: 'car', type: 'GROUND', action: 'RETIME_GROUND' },
    ],
    nodesById: { car: { reversible: true } },
  });
  assert.equal(result.decision, DECISION.SPLIT);
  assert.equal(result.actions.some((a) => a.action === 'REBOOK_FLIGHT'), true);
  assert.equal(result.escalations.length, 1);
  assert.match(result.escalations[0].reason, /non-refundable/);
});

test('ESCALATE when the flight itself breaches policy and nothing else is safe', () => {
  const result = decide({
    option: option({ price: { amount: 3000, currency: 'USD' } }),
    original: ORIGINAL,
    impacts: [{ nodeId: 'meeting', type: 'COMMITMENT', action: 'ESCALATE', reason: 'commitment at risk' }],
  });
  assert.equal(result.decision, DECISION.ESCALATE);
  assert.equal(result.actions.length, 0);
});

test('no viable option escalates rather than silently doing nothing', () => {
  const result = decide({ option: null, original: ORIGINAL, impacts: [] });
  assert.equal(result.decision, DECISION.ESCALATE);
  assert.match(result.escalations[0].reason, /no viable replacement/);
});

test('an over-cap flight still escalates while safe dependents proceed', () => {
  const result = decide({
    option: option({ price: { amount: 4000, currency: 'USD' } }),
    original: ORIGINAL,
    impacts: [{ nodeId: 'car', type: 'GROUND', action: 'RETIME_GROUND' }],
    nodesById: { car: { reversible: true } },
  });
  assert.equal(result.decision, DECISION.SPLIT);
  assert.equal(result.escalations[0].rule, 'COST_CAP');
});

test('the decision is repeatable for identical inputs', () => {
  const input = {
    option: option(),
    original: ORIGINAL,
    impacts: [{ nodeId: 'hotel', type: 'HOTEL', action: 'SHIFT_HOTEL' }],
    nodesById: { hotel: { refundable: true } },
  };
  assert.deepEqual(decide(input), decide(input));
});

test('a stricter member policy narrows what the agent may do', () => {
  const strict = { ...DEFAULT_POLICY, costCap: { amount: 10, currency: 'USD' } };
  const relaxed = decide({ option: option(), original: ORIGINAL, impacts: [] });
  const tightened = decide({ option: option(), original: ORIGINAL, impacts: [], policy: strict });
  assert.equal(relaxed.decision, DECISION.ACT);
  assert.equal(tightened.decision, DECISION.ESCALATE);
});

test('explainDecision states the verdict and the reasons', () => {
  const split = decide({
    option: option(),
    original: ORIGINAL,
    impacts: [{ nodeId: 'hotel', type: 'HOTEL', action: 'ESCALATE', reason: 'non-refundable hotel change' }],
  });
  const line = explainDecision(split);
  assert.match(line, /^SPLIT/);
  assert.match(line, /non-refundable/);
  assert.equal(explainDecision(null), 'no decision');
});
