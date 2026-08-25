import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rankOptions,
  scoreOption,
  viabilityIssues,
  explainChoice,
  arrivalUtcMinutes,
  SCORING_WEIGHTS,
  CABIN_RANK,
} from '../src/agent/options.js';

// The disrupted original: JFK->LAX nonstop, economy, on DL, $200.
const ORIGINAL = {
  airline: 'DL',
  origin: 'JFK',
  destination: 'LAX',
  departureTime: '2026-09-23T07:00:00',
  arrivalTime: '2026-09-23T10:00:00',
  arrivalOffsetHours: -7,
  stops: 0,
  cabin: 'ECONOMY',
  price: { amount: 200, currency: 'USD' },
};

function option(overrides = {}) {
  return {
    id: 'opt',
    airline: 'DL',
    flightNumber: 'DL100',
    origin: 'JFK',
    destination: 'LAX',
    departureTime: '2026-09-23T07:00:00',
    arrivalTime: '2026-09-23T10:00:00',
    stops: 0,
    cabin: 'ECONOMY',
    price: { amount: 200, currency: 'USD' },
    segments: [{ departureOffsetHours: -4, arrivalOffsetHours: -7 }],
    ...overrides,
  };
}

const ctx = { original: ORIGINAL };

test('an identical replacement scores zero', () => {
  const { total, breakdown } = scoreOption(option(), ctx);
  assert.equal(total, 0);
  assert.equal(breakdown.filter((b) => b.points !== 0).length, 0);
});

test('arriving later is penalised one point per minute', () => {
  const { total } = scoreOption(option({ arrivalTime: '2026-09-23T11:30:00' }), ctx);
  assert.equal(total, 90);
});

test('arriving early earns a credit, but a capped one', () => {
  const twoHoursEarly = scoreOption(option({ arrivalTime: '2026-09-23T08:00:00' }), ctx);
  assert.equal(twoHoursEarly.total, -30); // 120min * 0.25

  // 16 hours early must not out-score everything else on the board.
  const absurdlyEarly = scoreOption(option({
    departureTime: '2026-09-22T12:00:00',
    arrivalTime: '2026-09-22T18:00:00',
  }), ctx);
  assert.equal(absurdlyEarly.total, -SCORING_WEIGHTS.maxEarlyCredit);
});

test('extra stops and cabin downgrades carry their stated weights', () => {
  assert.equal(scoreOption(option({ stops: 1 }), ctx).total, SCORING_WEIGHTS.perExtraStop);
  const downgraded = scoreOption(
    option({ cabin: 'ECONOMY' }),
    { original: { ...ORIGINAL, cabin: 'BUSINESS' } },
  );
  assert.equal(downgraded.total, SCORING_WEIGHTS.perCabinDowngrade * 2);
});

test('an upgrade is not chased', () => {
  const { total } = scoreOption(option({ cabin: 'BUSINESS' }), ctx);
  assert.equal(total, 0);
});

test('switching airline costs a fixed amount', () => {
  const { total } = scoreOption(option({ airline: 'AA' }), ctx);
  assert.equal(total, SCORING_WEIGHTS.differentAirline);
});

test('price differences are scored in both directions', () => {
  assert.equal(scoreOption(option({ price: { amount: 300, currency: 'USD' } }), ctx).total, 50);
  assert.equal(scoreOption(option({ price: { amount: 100, currency: 'USD' } }), ctx).total, -25);
});

// The stated architectural boundary: cost governs autonomy, not feasibility.
test('an expensive option is ranked, never filtered out', () => {
  const pricey = option({ id: 'pricey', price: { amount: 5000, currency: 'USD' } });
  const { ranked, rejected } = rankOptions([pricey], { ...ctx, costCap: 250 });
  assert.equal(rejected.length, 0);
  assert.equal(ranked.length, 1);
  assert.ok(ranked[0].total > 0, 'it should score badly, but still be on the list');
});

test('an unpriced option cannot win by silently scoring nothing', () => {
  const { breakdown } = scoreOption(option({ price: undefined }), ctx);
  const priceLine = breakdown.find((b) => b.factor === 'price');
  assert.match(priceLine.detail, /no price/);
});

test('arrival is compared in UTC, so a different-timezone airport is judged fairly', () => {
  // Same instant, expressed in a timezone one hour further east.
  const sameInstant = option({
    destination: 'BUR',
    arrivalTime: '2026-09-23T11:00:00',
    segments: [{ departureOffsetHours: -4, arrivalOffsetHours: -6 }],
  });
  assert.equal(scoreOption(sameInstant, ctx).total, 0);
  assert.equal(arrivalUtcMinutes(sameInstant), arrivalUtcMinutes(option()));
});

// --- viability --------------------------------------------------------

test('an option departing before the member can get there is rejected', () => {
  const issues = viabilityIssues(option({ departureTime: '2026-09-23T05:00:00' }), {
    readyAt: '2026-09-23T06:00:00',
    readyAtOffsetHours: -4,
  });
  assert.match(issues.join(' '), /before the member can reach/);
});

test('an option arriving after the commitment is rejected', () => {
  const issues = viabilityIssues(option({ arrivalTime: '2026-09-23T18:00:00' }), {
    mustArriveBy: '2026-09-23T12:00:00',
    mustArriveByOffsetHours: -7,
  });
  assert.match(issues.join(' '), /after the latest useful arrival/);
});

test('a sold-out option is rejected', () => {
  assert.match(viabilityIssues(option({ seatsRemaining: 0 }), {}).join(' '), /no seats/);
});

test('nearby-airport alternates are allowed when listed, refused when not', () => {
  const toBur = option({ destination: 'BUR' });
  assert.deepEqual(viabilityIssues(toBur, { acceptableDestinations: ['LAX', 'BUR'] }), []);
  assert.match(
    viabilityIssues(toBur, { acceptableDestinations: ['LAX'] }).join(' '),
    /outside the acceptable airports/,
  );
});

test('an option with unusable times is rejected rather than scored', () => {
  assert.match(viabilityIssues(option({ arrivalTime: 'nonsense' }), {}).join(' '), /unusable/);
});

// --- ranking ----------------------------------------------------------

test('ranking puts the least inconvenient option first and reports rejects', () => {
  const good = option({ id: 'good', flightNumber: 'DL200', arrivalTime: '2026-09-23T10:30:00' });
  const worse = option({ id: 'worse', flightNumber: 'AA300', airline: 'AA', stops: 1, arrivalTime: '2026-09-23T13:00:00' });
  const impossible = option({ id: 'impossible', seatsRemaining: 0 });

  const { ranked, rejected, best } = rankOptions([worse, good, impossible], ctx);

  assert.equal(ranked.length, 2);
  assert.equal(best.option.id, 'good');
  assert.equal(ranked[1].option.id, 'worse');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].option.id, 'impossible');
});

test('ties break deterministically regardless of input order', () => {
  const a = option({ id: 'aaa', price: { amount: 200, currency: 'USD' } });
  const b = option({ id: 'bbb', price: { amount: 200, currency: 'USD' } });
  assert.equal(rankOptions([a, b], ctx).best.option.id, 'aaa');
  assert.equal(rankOptions([b, a], ctx).best.option.id, 'aaa');
});

test('a cheaper tie wins over a pricier one', () => {
  const cheap = option({ id: 'zcheap', price: { amount: 150, currency: 'USD' } });
  const dear = option({ id: 'adear', price: { amount: 150.01, currency: 'USD' } });
  // Both have the same arrival; price decides on score, before the id tiebreak.
  assert.equal(rankOptions([dear, cheap], ctx).best.option.id, 'zcheap');
});

test('ranking an empty candidate list yields no best rather than throwing', () => {
  const { ranked, best } = rankOptions([], ctx);
  assert.deepEqual(ranked, []);
  assert.equal(best, null);
});

test('scoring is repeatable — the same inputs give the same answer', () => {
  const candidates = [
    option({ id: 'a', arrivalTime: '2026-09-23T12:00:00', airline: 'AA' }),
    option({ id: 'b', stops: 1 }),
    option({ id: 'c', price: { amount: 275, currency: 'USD' } }),
  ];
  const first = rankOptions(candidates, ctx);
  const second = rankOptions(candidates, ctx);
  assert.deepEqual(
    first.ranked.map((r) => [r.option.id, r.total]),
    second.ranked.map((r) => [r.option.id, r.total]),
  );
});

test('weights can be overridden per call without mutating the defaults', () => {
  const late = option({ arrivalTime: '2026-09-23T11:00:00' });
  const doubled = scoreOption(late, { ...ctx, weights: { perMinuteLate: 2 } });
  assert.equal(doubled.total, 120);
  assert.equal(SCORING_WEIGHTS.perMinuteLate, 1, 'defaults must be untouched');
});

test('every score carries an attributable breakdown', () => {
  const { breakdown } = scoreOption(
    option({ arrivalTime: '2026-09-23T11:00:00', stops: 1, airline: 'AA' }),
    ctx,
  );
  const factors = breakdown.map((b) => b.factor);
  assert.ok(factors.includes('arrival'));
  assert.ok(factors.includes('stops'));
  assert.ok(factors.includes('airline'));
  for (const item of breakdown) assert.ok(item.detail, 'each factor must explain itself');
});

test('explainChoice produces one auditable line', () => {
  const { best } = rankOptions([option({ arrivalTime: '2026-09-23T11:00:00' })], ctx);
  const line = explainChoice(best);
  assert.match(line, /DL100/);
  assert.match(line, /60min later/);
  assert.equal(explainChoice(null), 'no viable option');
});

test('cabin ranking is ordered worst to best', () => {
  assert.deepEqual(CABIN_RANK, ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']);
});

// Found live: a Duffel search returned the same AS0227 three times (different
// fare classes) and they filled the entire top three, so the executor's three
// retries were really one chance.
test('duplicate copies of one flight are collapsed', () => {
  const dup = (id) => option({ id, flightNumber: 'AS227', departureTime: '2026-09-23T07:00:00' });
  const { ranked, duplicatesCollapsed } = rankOptions(
    [dup('a'), dup('b'), dup('c'), option({ id: 'other', flightNumber: 'DL999' })],
    ctx,
  );
  assert.equal(ranked.length, 2, 'three fare classes of one flight are one candidate');
  assert.equal(duplicatesCollapsed, 2);
});

test('the best-scoring copy survives deduplication', () => {
  const worse = option({ id: 'worse', flightNumber: 'AS227', arrivalTime: '2026-09-23T14:00:00', price: { amount: 400, currency: 'USD' } });
  const better = option({ id: 'better', flightNumber: 'AS227', arrivalTime: '2026-09-23T14:00:00', price: { amount: 210, currency: 'USD' } });
  const { ranked } = rankOptions([worse, better], ctx);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].option.id, 'better');
});

test('flights differing by departure time are not treated as duplicates', () => {
  const { ranked } = rankOptions([
    option({ id: 'am', flightNumber: 'AS227', departureTime: '2026-09-23T07:00:00' }),
    option({ id: 'pm', flightNumber: 'AS227', departureTime: '2026-09-23T15:00:00' }),
  ], ctx);
  assert.equal(ranked.length, 2);
});

test('deduplication can be turned off when a caller wants every fare class', () => {
  const dup = (id) => option({ id, flightNumber: 'AS227', departureTime: '2026-09-23T07:00:00' });
  const { ranked } = rankOptions([dup('a'), dup('b')], { ...ctx, keepDuplicateFlights: true });
  assert.equal(ranked.length, 2);
});
