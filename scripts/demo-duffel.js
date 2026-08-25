#!/usr/bin/env node
// End-to-end check of the Duffel adapter through the provider port, exercising
// the Phase 6 ordering rule against a REAL booking API:
//   search -> seat map -> book -> confirm -> release
//
//   npm run demo:duffel
//
// Requires BOOKING_PROVIDER=duffel and a duffel_test_ token.

import { config } from '../src/config.js';
import * as duffelAdapter from '../src/duffel/adapter.js';
import { partitionByPlausibility } from '../src/normalize/plausibility.js';
import { rankOptions } from '../src/agent/options.js';
import { buildIdempotencyKey } from '../src/agent/executor.js';

if (!config.duffel.accessToken) {
  console.error('DUFFEL_ACCESS_TOKEN missing. Fill .env first.');
  process.exit(1);
}

const departuredate = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);

console.log(`[1] search JFK-LAX ${departuredate}`);
const offers = await duffelAdapter.searchFlights({ origin: 'JFK', destination: 'LAX', departuredate });
const { kept, rejected } = partitionByPlausibility(offers);
console.log(`    ${offers.length} offers, ${kept.length} plausible, ${rejected.length} dropped`);

const original = {
  cabin: 'ECONOMY',
  arrivalTime: kept[0]?.arrivalTime,
  arrivalOffsetHours: kept[0]?.segments.at(-1)?.arrivalOffsetHours,
  stops: 0,
  price: { amount: 200, currency: kept[0]?.price.currency },
};
const { ranked } = rankOptions(kept, { original });
console.log(`[2] ranked ${ranked.length}; best = ${ranked[0]?.option.flightNumber} score ${ranked[0]?.total}`);

// Prefer a Duffel Airways offer — partner offers often carry no seat map.
const chosen = ranked.find((r) => r.option.airline === 'ZZ')?.option ?? ranked[0]?.option;
if (!chosen) { console.log('no bookable option'); process.exit(0); }

console.log(`[3] seat map for ${chosen.flightNumber}`);
const seatMap = await duffelAdapter.getSeatMap(chosen.offerId);
console.log(`    ${seatMap.cabinClass}: ${seatMap.rows.length} rows, ${seatMap.availableSeats}/${seatMap.totalSeats} available`);
if (seatMap.rows.length) {
  const sample = seatMap.rows[0].seats.map((s) => `${s.designator}${s.available ? '' : 'x'}`).join(' ');
  console.log(`    row 1: ${sample}`);
}

const key = buildIdempotencyKey({ tripId: 'duffel-demo', optionId: chosen.id, attempt: 1 });
console.log(`[4] book (idempotency ${key.slice(0, 34)}…)`);
const booking = await duffelAdapter.bookFlight({ tripId: 'duffel-demo', option: chosen, idempotencyKey: key });
console.log(`    ${booking.status}  ref ${booking.bookingReference}  ${booking.total.amount} ${booking.total.currency}`);

console.log('[5] confirm independently BEFORE releasing anything');
const confirmed = await duffelAdapter.getBooking(booking.id);
console.log(`    ${confirmed.status}  ref ${confirmed.bookingReference}`);
if (confirmed.status !== 'CONFIRMED') {
  console.log('    NOT confirmed — a real executor would keep the old ticket and stop here');
  process.exit(0);
}

console.log('[6] idempotency: re-book with the SAME key');
const again = await duffelAdapter.bookFlight({ tripId: 'duffel-demo', option: chosen, idempotencyKey: key });
console.log(`    ${again.id === booking.id ? 'same order returned — no double booking' : 'DIFFERENT ORDER — idempotency FAILED'}`);

console.log('[7] release');
const cancelled = await duffelAdapter.cancelBooking(booking.id);
console.log(`    ${cancelled.status}  refund ${cancelled.refundAmount} ${cancelled.refundCurrency}`);
