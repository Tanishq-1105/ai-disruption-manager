import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeRecovery,
  executeDependentActions,
  buildIdempotencyKey,
  explainExecution,
  OUTCOME,
  STATUS,
} from '../src/agent/executor.js';
import { DECISION, AUTONOMY, DEFAULT_POLICY } from '../src/agent/policy.js';

const ORIGINAL = {
  bookingId: 'old-booking',
  cabin: 'ECONOMY',
  arrivalTime: '2026-09-23T10:00:00',
  price: { amount: 200, currency: 'USD' },
};

function option(id, overrides = {}) {
  return {
    id,
    flightNumber: `DL${id}`,
    cabin: 'ECONOMY',
    arrivalTime: '2026-09-23T12:00:00',
    price: { amount: 250, currency: 'USD' },
    ...overrides,
  };
}

const AUTHORISED = {
  decision: DECISION.ACT,
  actions: [{ action: 'REBOOK_FLIGHT', autonomy: AUTONOMY.AUTO, rule: 'WITHIN_LIMITS' }],
  escalations: [],
};

// A provider double that records the exact order of calls — the ordering rule
// is the thing under test, so the sequence matters more than the return values.
function fakeProvider({ failBookings = 0, failRelease = false, bookingStatus = 'CONFIRMED' } = {}) {
  const calls = [];
  let bookAttempts = 0;
  const seenKeys = new Map();
  return {
    calls,
    seenKeys,
    async bookFlight({ tripId, option: opt, idempotencyKey }) {
      calls.push(`book:${opt.id}`);
      if (seenKeys.has(idempotencyKey)) return seenKeys.get(idempotencyKey);
      bookAttempts += 1;
      if (bookAttempts <= failBookings) throw new Error('Simulated booking failure');
      const booking = { id: `booking-${opt.id}`, tripId, option: opt, status: bookingStatus };
      seenKeys.set(idempotencyKey, booking);
      return booking;
    },
    async cancelBooking(id) {
      calls.push(`release:${id}`);
      if (failRelease) throw new Error('release refused');
      return { id, status: 'CANCELLED' };
    },
  };
}

const base = (provider, ranked, extra = {}) => ({
  tripId: 'trip-1',
  original: ORIGINAL,
  ranked,
  decision: AUTHORISED,
  provider,
  ...extra,
});

// --- the ordering rule --------------------------------------------------

test('books the new ticket before releasing the old one', async () => {
  const provider = fakeProvider();
  const result = await executeRecovery(base(provider, [option('a')]));

  assert.deepEqual(provider.calls, ['book:a', 'release:old-booking']);
  assert.equal(result.status, STATUS.RECOVERED);
});

test('a booking failure never releases the old ticket', async () => {
  const provider = fakeProvider({ failBookings: 1 });
  const result = await executeRecovery(base(provider, [option('a'), option('b')]));

  // First candidate failed, second succeeded — and the release only ever
  // happened after a confirmed booking.
  assert.deepEqual(provider.calls, ['book:a', 'book:b', 'release:old-booking']);
  assert.equal(result.status, STATUS.RECOVERED);
  assert.equal(result.attempts[0].outcome, OUTCOME.BOOKING_FAILED);
});

test('when every candidate fails the member keeps the original ticket', async () => {
  const provider = fakeProvider({ failBookings: 99 });
  const result = await executeRecovery(base(provider, [option('a'), option('b')]));

  assert.equal(result.status, STATUS.EXHAUSTED);
  assert.equal(result.booking, null);
  assert.equal(provider.calls.filter((c) => c.startsWith('release')).length, 0,
    'the old ticket must never be released when nothing replaced it');
  assert.ok(result.audit.some((a) => a.oldTicketRetained === true));
});

test('an unconfirmed booking does not trigger a release', async () => {
  const provider = fakeProvider({ bookingStatus: 'PENDING' });
  const result = await executeRecovery(base(provider, [option('a')]));

  assert.equal(result.status, STATUS.EXHAUSTED);
  assert.equal(provider.calls.filter((c) => c.startsWith('release')).length, 0);
  assert.equal(result.attempts[0].outcome, OUTCOME.NOT_CONFIRMED);
});

// Two tickets beats zero tickets.
test('a failed release does not roll back the confirmed new booking', async () => {
  const provider = fakeProvider({ failRelease: true });
  const result = await executeRecovery(base(provider, [option('a')]));

  assert.equal(result.status, STATUS.RECOVERED_NEEDS_ATTENTION);
  assert.ok(result.booking, 'the member must keep the ticket that actually works');
  const release = result.audit.find((a) => a.action === 'RELEASE_OLD');
  assert.equal(release.outcome, OUTCOME.OLD_RELEASE_FAILED);
  assert.match(release.detail, /two bookings/);
});

// --- authority ----------------------------------------------------------

test('nothing is executed when policy did not authorise a rebooking', async () => {
  const provider = fakeProvider();
  const result = await executeRecovery(base(provider, [option('a')], {
    decision: { decision: DECISION.ESCALATE, actions: [], escalations: [{ reason: 'over cap' }] },
  }));

  assert.equal(result.status, STATUS.NOTHING_AUTHORISED);
  assert.deepEqual(provider.calls, []);
  assert.equal(result.audit[0].outcome, OUTCOME.NOT_AUTHORISED);
});

// The subtle one: a failure must not become a licence to overspend.
test('a fallback candidate is re-checked against policy before booking', async () => {
  const provider = fakeProvider({ failBookings: 1 });
  const cheapThenExpensive = [
    option('a'),
    option('b', { price: { amount: 9000, currency: 'USD' } }),
  ];
  const result = await executeRecovery(base(provider, cheapThenExpensive));

  assert.equal(provider.calls.filter((c) => c === 'book:b').length, 0,
    'the over-cap fallback must never be booked');
  assert.equal(result.status, STATUS.EXHAUSTED);
  assert.equal(result.attempts[1].outcome, OUTCOME.NOT_AUTHORISED);
});

test('an over-cap first candidate is skipped and a compliant one is taken', async () => {
  const provider = fakeProvider();
  const result = await executeRecovery(base(provider, [
    option('pricey', { price: { amount: 9000, currency: 'USD' } }),
    option('sane'),
  ]));

  assert.equal(result.status, STATUS.RECOVERED);
  assert.equal(result.option.id, 'sane');
  assert.equal(provider.calls[0], 'book:sane');
});

test('a stricter policy narrows what the executor will book', async () => {
  const provider = fakeProvider();
  const result = await executeRecovery(base(provider, [option('a')], {
    policy: { ...DEFAULT_POLICY, costCap: { amount: 5, currency: 'USD' } },
  }));
  assert.equal(result.status, STATUS.EXHAUSTED);
  assert.deepEqual(provider.calls, []);
});

// --- idempotency --------------------------------------------------------

test('idempotency keys are deterministic and unique per attempt', () => {
  const a = buildIdempotencyKey({ tripId: 't', optionId: 'o', attempt: 1 });
  assert.equal(a, buildIdempotencyKey({ tripId: 't', optionId: 'o', attempt: 1 }));
  assert.notEqual(a, buildIdempotencyKey({ tripId: 't', optionId: 'o', attempt: 2 }));
  assert.notEqual(a, buildIdempotencyKey({ tripId: 't', optionId: 'other', attempt: 1 }));
});

test('every booking call carries an idempotency key', async () => {
  const provider = fakeProvider();
  await executeRecovery(base(provider, [option('a')]));
  assert.equal(provider.seenKeys.size, 1);
  assert.equal([...provider.seenKeys.keys()][0], 'trip-1:a:1');
});

test('re-running the same recovery does not book a second seat', async () => {
  const provider = fakeProvider();
  const first = await executeRecovery(base(provider, [option('a')]));
  const second = await executeRecovery(base(provider, [option('a')]));
  assert.equal(first.booking.id, second.booking.id);
  assert.equal(provider.seenKeys.size, 1, 'the retry reused the key rather than buying again');
});

// --- audit --------------------------------------------------------------

test('every action records the rule that authorised it', async () => {
  const provider = fakeProvider();
  const result = await executeRecovery(base(provider, [option('a')]));
  assert.ok(result.audit.length >= 2);
  for (const entry of result.audit) {
    assert.ok(entry.at, 'every entry is timestamped');
    assert.ok(entry.authorisedBy, 'every entry names its authorising rule');
    assert.equal(entry.tripId, 'trip-1');
  }
});

test('the audit records the booking and the release in order', async () => {
  const provider = fakeProvider();
  const { audit } = await executeRecovery(base(provider, [option('a')]));
  const actions = audit.map((a) => a.action);
  assert.ok(actions.indexOf('BOOK_NEW') < actions.indexOf('RELEASE_OLD'));
});

test('maxAttempts bounds how many candidates are tried', async () => {
  const provider = fakeProvider({ failBookings: 99 });
  const many = ['a', 'b', 'c', 'd', 'e'].map((id) => option(id));
  const result = await executeRecovery(base(provider, many, { maxAttempts: 2 }));
  assert.equal(result.attempts.length, 2);
});

test('a trip with no prior booking still books cleanly', async () => {
  const provider = fakeProvider();
  const result = await executeRecovery(base(provider, [option('a')], {
    original: { ...ORIGINAL, bookingId: undefined },
  }));
  assert.equal(result.status, STATUS.RECOVERED);
  assert.equal(provider.calls.filter((c) => c.startsWith('release')).length, 0);
});

// --- dependent actions --------------------------------------------------

test('dependent adjustments run only for auto-authorised actions', async () => {
  const applied = [];
  const provider = { async adjustNode({ nodeId }) { applied.push(nodeId); } };
  const decision = {
    actions: [
      { action: 'REBOOK_FLIGHT', autonomy: AUTONOMY.AUTO, rule: 'WITHIN_LIMITS' },
      { action: 'SHIFT_HOTEL', nodeId: 'hotel', autonomy: AUTONOMY.AUTO, rule: 'SHIFT_HOTEL' },
      { action: 'RETIME_GROUND', nodeId: 'car', autonomy: AUTONOMY.AUTO, rule: 'RETIME_GROUND' },
    ],
  };
  const { results } = await executeDependentActions({ tripId: 't', decision, provider });

  assert.deepEqual(applied, ['hotel', 'car'], 'the flight is handled by executeRecovery, not here');
  assert.equal(results.every((r) => r.outcome === 'APPLIED'), true);
});

test('a failing dependent adjustment is recorded, not thrown', async () => {
  const provider = { async adjustNode() { throw new Error('hotel API down'); } };
  const decision = {
    actions: [{ action: 'SHIFT_HOTEL', nodeId: 'hotel', autonomy: AUTONOMY.AUTO, rule: 'SHIFT_HOTEL' }],
  };
  const { results, audit } = await executeDependentActions({ tripId: 't', decision, provider });

  assert.equal(results[0].outcome, 'FAILED');
  assert.match(audit[0].detail, /hotel API down/);
});

test('missing provider support is reported rather than crashing', async () => {
  const decision = {
    actions: [{ action: 'SHIFT_HOTEL', nodeId: 'hotel', autonomy: AUTONOMY.AUTO, rule: 'SHIFT_HOTEL' }],
  };
  const { results } = await executeDependentActions({ tripId: 't', decision, provider: {} });
  assert.equal(results[0].outcome, 'UNSUPPORTED');
});

test('explainExecution states what actually happened', async () => {
  const provider = fakeProvider();
  const ok = await executeRecovery(base(provider, [option('a')]));
  assert.match(explainExecution(ok), /^RECOVERED/);

  const failed = await executeRecovery(base(fakeProvider({ failBookings: 99 }), [option('z')]));
  assert.match(explainExecution(failed), /member keeps the original ticket/);
  assert.equal(explainExecution(null), 'nothing executed');
});
