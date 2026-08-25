import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeMemberMessage, composeMessages } from '../src/agent/notifier.js';
import { DECISION } from '../src/agent/policy.js';
import { STATUS } from '../src/agent/executor.js';

const CHOSEN = {
  flightNumber: 'DL742',
  departureTime: '2026-09-24T07:00:00',
  arrivalTime: '2026-09-24T10:00:00',
  price: { amount: 203.4, currency: 'USD' },
};

function recovery(overrides = {}) {
  return {
    event: { type: 'CANCELLATION' },
    decision: { decision: DECISION.ACT, escalations: [] },
    execution: { status: STATUS.RECOVERED },
    ranked: [CHOSEN],
    dependents: [],
    ...overrides,
  };
}

test('a clean rebooking leads with the reassurance', () => {
  const msg = composeMemberMessage(recovery());
  assert.equal(msg.severity, 'REBOOKED');
  assert.match(msg.headline, /already rebooked/);
  assert.match(msg.body, /DL742/);
  assert.match(msg.body, /07:00/);
  assert.match(msg.body, /203.4 USD/);
});

test('adjusted hotel and ride are named in plain words', () => {
  const msg = composeMemberMessage(recovery({
    dependents: [
      { action: 'SHIFT_HOTEL', outcome: 'APPLIED' },
      { action: 'RETIME_GROUND', outcome: 'APPLIED' },
    ],
  }));
  assert.match(msg.body, /your hotel and your ride/);
});

test('a dependent that did not apply is not claimed', () => {
  const msg = composeMemberMessage(recovery({
    dependents: [{ action: 'SHIFT_HOTEL', outcome: 'FAILED' }],
  }));
  assert.equal(/your hotel/.test(msg.body), false);
});

test('a SPLIT names the one open item and asks for a decision', () => {
  const msg = composeMemberMessage(recovery({
    decision: { decision: DECISION.SPLIT, escalations: [{ reason: 'commitment at risk' }] },
  }));
  assert.equal(msg.severity, 'REBOOKED_WITH_QUESTION');
  assert.match(msg.headline, /one thing needs you/);
  assert.match(msg.body, /commitment at risk/);
  assert.ok(msg.actions.includes('Review the open item'));
});

// The most important sentence in the product.
test('a failed recovery states first that the old ticket is intact', () => {
  const msg = composeMemberMessage(recovery({
    execution: { status: STATUS.EXHAUSTED },
    decision: { decision: DECISION.ESCALATE, escalations: [{ reason: 'over the cost cap' }] },
  }));
  assert.equal(msg.severity, 'ACTION_REQUIRED');
  assert.match(msg.body, /original ticket has not been released/);
  assert.match(msg.body, /over the cost cap/);
});

test('nothing authorised reads the same as exhausted to the member', () => {
  const msg = composeMemberMessage(recovery({
    execution: { status: STATUS.NOTHING_AUTHORISED },
    decision: { decision: DECISION.ESCALATE, escalations: [] },
  }));
  assert.equal(msg.severity, 'ACTION_REQUIRED');
  assert.match(msg.body, /nothing has been lost/);
});

test('a double-booking is disclosed, not hidden', () => {
  const msg = composeMemberMessage(recovery({
    execution: { status: STATUS.RECOVERED_NEEDS_ATTENTION },
  }));
  assert.match(msg.body, /could not release your original ticket/);
  assert.equal(msg.severity, 'REBOOKED_WITH_QUESTION');
});

test('the sentence is capitalised when no name opens it', () => {
  assert.match(composeMemberMessage(recovery(), { memberName: 'Priya' }).body, /^Priya, /);
  assert.match(composeMemberMessage(recovery()).body, /^Your flight/);
});

test('composition is deterministic', () => {
  assert.deepEqual(composeMemberMessage(recovery()), composeMemberMessage(recovery()));
});

test('two disrupted legs produce two messages, not one merged one', () => {
  const messages = composeMessages({
    recoveries: [recovery(), recovery(), { skipped: 'connection risk is reported, not auto-rebooked' }],
  });
  assert.equal(messages.length, 2);
});

test('a missing fare is simply not mentioned rather than shown as blank', () => {
  const msg = composeMemberMessage(recovery({ ranked: [{ ...CHOSEN, price: undefined }] }));
  assert.equal(/Fare/.test(msg.body), false);
});

// Found live: attempts 1-3 failed and attempt 4 booked a different flight, but
// the message named ranked[0]. The member would have gone to the wrong gate.
test('the message names the flight that was BOOKED, not the top-ranked one', () => {
  const booked = { ...CHOSEN, flightNumber: 'ZZ6057', departureTime: '2026-09-24T14:00:00', arrivalTime: '2026-09-24T17:10:00' };
  const msg = composeMemberMessage(recovery({
    ranked: [CHOSEN],                       // AS0227 ranked first
    execution: { status: STATUS.RECOVERED, option: booked }, // ZZ6057 actually booked
  }));
  assert.match(msg.body, /ZZ6057/);
  assert.equal(/DL742/.test(msg.body), false, 'must never name a flight the member is not on');
});

test('it falls back to the ranking only when nothing was booked', () => {
  const msg = composeMemberMessage(recovery({ execution: { status: STATUS.RECOVERED } }));
  assert.match(msg.body, /DL742/);
});
