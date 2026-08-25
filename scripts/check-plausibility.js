#!/usr/bin/env node
// Runs the plausibility filter against a live search so you can see exactly
// what it drops and why. Network + credentials, so it lives outside npm test.
//
//   node scripts/check-plausibility.js --origin=JFK --destination=LAX

import { config } from '../src/config.js';
import { searchFlights } from '../src/sabre/client.js';
import { normalizePlausibleFlightSearchResults } from '../src/normalize/flights.js';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a) => {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    return m ? [[m[1], m[2]]] : [];
  }),
);

const origin = args.origin ?? 'JFK';
const destination = args.destination ?? 'LAX';
const departuredate = args.date ?? new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);

if (!config.sabre.clientId) {
  console.error('SABRE_CLIENT_ID missing. Fill .env first.');
  process.exit(1);
}

const raw = await searchFlights({ origin, destination, departuredate, limit: 50 });
const { kept, rejected } = normalizePlausibleFlightSearchResults(raw);

console.log(`${origin}-${destination} on ${departuredate}`);
console.log(`  kept     : ${kept.length}`);
console.log(`  rejected : ${rejected.length}`);
for (const { itinerary, issues } of rejected) {
  const route = itinerary.segments.map((s) => `${s.origin}-${s.destination}`).join('/');
  console.log(`\n  ${itinerary.flightNumber}  ${route}  total ${itinerary.durationMinutes}min`);
  for (const issue of issues) console.log(`    - ${issue}`);
}
if (rejected.length === 0) console.log('\n  nothing implausible in this response.');
