#!/usr/bin/env node
// End-to-end Phase 4 check against live data: search, drop the impossible,
// treat one itinerary as cancelled, and rank the real replacements.
//
//   npm run demo:rebook
//
// Network + credentials, so it lives outside npm test.

import { config } from '../src/config.js';
import { searchFlights } from '../src/sabre/client.js';
import { normalizePlausibleFlightSearchResults } from '../src/normalize/flights.js';
import { rankOptions, explainChoice } from '../src/agent/options.js';

const args = Object.fromEntries(process.argv.slice(2).flatMap((a) => {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  return m ? [[m[1], m[2]]] : [];
}));

// JFK-LAX is the only route with cached data on this account.
const origin = args.origin ?? 'JFK';
const destination = args.destination ?? 'LAX';
const departuredate = args.date ?? new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);

if (!config.sabre.clientId) {
  console.error('SABRE_CLIENT_ID missing. Fill .env first.');
  process.exit(1);
}

const raw = await searchFlights({ origin, destination, departuredate, limit: 50 });
const { kept, rejected } = normalizePlausibleFlightSearchResults(raw);

console.log(`${origin}-${destination} ${departuredate}`);
console.log(`  ${kept.length} usable itineraries (${rejected.length} implausible dropped)\n`);

if (kept.length < 2) {
  console.log('Not enough options to demonstrate a rebook.');
  process.exit(0);
}

// Pretend the member was on the earliest nonstop and it just got cancelled.
const cancelled = kept.find((f) => f.stops === 0) ?? kept[0];
const original = {
  ...cancelled,
  cabin: 'ECONOMY',
  arrivalOffsetHours: cancelled.segments[cancelled.segments.length - 1]?.arrivalOffsetHours,
};

console.log('CANCELLED');
console.log(`  ${original.flightNumber}  dep ${original.departureTime}  arr ${original.arrivalTime}` +
  `  ${original.stops} stop  ${original.price.amount} ${original.price.currency}\n`);

const candidates = kept
  .filter((f) => f.id !== cancelled.id)
  .map((f) => ({ ...f, cabin: 'ECONOMY' }));

const { ranked, rejected: unusable } = rankOptions(candidates, {
  original,
  // The member is at the airport already — they were about to board.
  readyAt: original.departureTime,
  readyAtOffsetHours: original.segments[0]?.departureOffsetHours,
});

console.log(`RANKED ${ranked.length} replacements (${unusable.length} not viable)\n`);
for (const scored of ranked.slice(0, 5)) {
  const o = scored.option;
  console.log(`  ${String(scored.total).padStart(7)}  ${o.flightNumber.padEnd(7)} dep ${o.departureTime.slice(11, 16)}  arr ${o.arrivalTime.slice(11, 16)}  ${o.stops} stop  ${o.price.amount} ${o.price.currency}`);
  for (const b of scored.breakdown) {
    if (b.points !== 0) console.log(`           ${b.points > 0 ? '+' : ''}${b.points}  ${b.factor}: ${b.detail}`);
  }
}

console.log(`\nAGENT WOULD PICK:\n  ${explainChoice(ranked[0])}`);
if (unusable.length > 0) {
  console.log(`\nNot viable (sample): ${unusable[0].issues[0]}`);
}
