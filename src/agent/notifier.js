// Notifier — PURE. Composes the single message the member receives.
//
// The product's promise is "the member wakes up already rebooked", and this is
// where that lands. One message, not a stream of alerts: it says what broke,
// what was done, what it cost, and — only when it exists — what still needs an
// answer.
//
// Composition is deterministic string building over the recovery result. No
// LLM writes this: the message states money spent and actions taken on a
// member's behalf, so it has to say exactly what the audit trail says. A
// generated paraphrase that drifts from the record is a liability, not a
// feature.
//
// Delivery is somebody else's job. This returns the content; a channel adapter
// (in-app card, email, WhatsApp) sends it.

import { DECISION } from './policy.js';
import { STATUS } from './executor.js';

function shortTime(iso) {
  if (typeof iso !== 'string') return '';
  const timePart = iso.slice(11, 16);
  return timePart || '';
}

function money(price) {
  if (!price || !Number.isFinite(price.amount)) return null;
  return `${Math.round(price.amount * 100) / 100} ${price.currency ?? ''}`.trim();
}

/**
 * Builds the member-facing message for one recovery.
 *
 * Returns a structured object rather than a blob so each channel can render it
 * appropriately — a push notification wants `headline`, an email wants `body`,
 * an in-app card wants the parts separately.
 */
export function composeMemberMessage(recovery, { memberName = null } = {}) {
  const { event, decision, execution, ranked = [], dependents = [] } = recovery ?? {};
  const greeting = memberName ? `${memberName}, ` : '';
  // Without a greeting the sentence starts the message, so it needs its capital.
  const opens = (sentence) => (greeting ? `${greeting}${sentence}` : sentence.charAt(0).toUpperCase() + sentence.slice(1));
  const status = execution?.status;
  // What was BOOKED, not what was ranked first. Attempts can fail and fall
  // through, so reading the ranking here would tell the member they are on a
  // flight they are not on — the exact drift this module exists to prevent.
  const chosen = execution?.option ?? ranked[0];

  // --- nothing was recovered -------------------------------------------
  if (status === STATUS.EXHAUSTED || status === STATUS.NOTHING_AUTHORISED) {
    const reasons = (decision?.escalations ?? []).map((e) => e.reason).filter(Boolean);
    return {
      severity: 'ACTION_REQUIRED',
      headline: 'Your flight was cancelled — we need your call',
      body: [
        opens('your flight was cancelled and we could not rebook you automatically.'),
        // The single most reassuring fact, stated first and plainly.
        'Your original ticket has not been released, so nothing has been lost.',
        reasons.length ? `Why we stopped: ${reasons.join('; ')}.` : null,
        'Open the app to choose from the alternatives we found.',
      ].filter(Boolean).join(' '),
      actions: ['Review alternatives'],
      escalations: reasons,
    };
  }

  // --- rebooked ----------------------------------------------------------
  const flight = chosen?.flightNumber ?? chosen?.optionId ?? 'your new flight';
  const depart = shortTime(chosen?.departureTime);
  const arrive = shortTime(chosen?.arrivalTime);
  const fare = money(chosen?.price);

  const adjusted = dependents
    .filter((d) => d.outcome === 'APPLIED')
    .map((d) => (d.action === 'SHIFT_HOTEL' ? 'your hotel' : 'your ride'));

  const escalations = (decision?.escalations ?? [])
    .map((e) => e.reason)
    .filter(Boolean);

  const sentences = [
    opens('your flight was cancelled overnight and we have already rebooked you.'),
    depart && arrive
      ? `You are now on ${flight}, departing ${depart} and arriving ${arrive}.`
      : `You are now on ${flight}.`,
  ];

  if (fare) sentences.push(`Fare ${fare}, within your limits.`);
  if (adjusted.length) sentences.push(`We also moved ${adjusted.join(' and ')} to match.`);

  // The old ticket is only mentioned when there is something to say about it -
  // silence means it was released cleanly, which is the expected case.
  if (status === STATUS.RECOVERED_NEEDS_ATTENTION) {
    sentences.push('One thing to check: we could not release your original ticket, so it may still show as active.');
  }

  if (escalations.length) {
    sentences.push(`We left one thing for you to decide: ${escalations.join('; ')}.`);
  }

  return {
    severity: escalations.length || status === STATUS.RECOVERED_NEEDS_ATTENTION
      ? 'REBOOKED_WITH_QUESTION'
      : 'REBOOKED',
    headline: decision?.decision === DECISION.SPLIT
      ? 'Rebooked — one thing needs you'
      : 'You are already rebooked',
    body: sentences.join(' '),
    actions: escalations.length ? ['Review the open item', 'See new itinerary'] : ['See new itinerary'],
    escalations,
    disruption: event?.type ?? null,
  };
}

/**
 * One message per recovery in a run. A member with two disrupted legs gets two
 * clear messages rather than one merged, ambiguous one.
 */
export function composeMessages(result, options = {}) {
  return (result?.recoveries ?? [])
    .filter((r) => !r.skipped)
    .map((r) => composeMemberMessage(r, options));
}
