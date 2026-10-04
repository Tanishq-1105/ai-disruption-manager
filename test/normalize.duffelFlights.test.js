import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDuffelOffers,
  normalizeSeatMap,
  isoDurationToMinutes,
  hoursFromZone,
} from '../src/normalize/duffelFlights.js';
import { assessItinerary } from '../src/normalize/plausibility.js';
import { scoreOption } from '../src/agent/options.js';

// Shape captured from a live Duffel test-mode response, 2026-08-25.
const OFFER = {
  id: 'off_0000B9jb9FgNezPosg',
  total_amount: '164.08',
  total_currency: 'EUR',
  expires_at: '2026-08-25T13:00:00Z',
  conditions: { refund_before_departure: { allowed: true, penalty_amount: '0.00' } },
  slices: [{
    duration: 'PT6H5M',
    segments: [{
      marketing_carrier: { iata_code: 'ZZ' },
      marketing_carrier_flight_number: '0763',
      origin: { iata_code: 'JFK', time_zone: 'America/New_York' },
      destination: { iata_code: 'LAX', time_zone: 'America/Los_Angeles' },
      departing_at: '2026-09-24T17:48:00',
      arriving_at: '2026-09-24T20:53:00',
      duration: 'PT6H5M',
      passengers: [{ cabin_class: 'economy' }],
    }],
  }],
};

test('a Duffel offer normalizes to the same shape as a Sabre itinerary', () => {
  const [flight] = normalizeDuffelOffers([OFFER]);

  assert.equal(flight.airline, 'ZZ');
  assert.equal(flight.flightNumber, 'ZZ0763');
  assert.equal(flight.origin, 'JFK');
  assert.equal(flight.destination, 'LAX');
  assert.equal(flight.stops, 0);
  assert.equal(flight.cabin, 'ECONOMY');
  assert.equal(flight.refundable, true);
  assert.deepEqual(flight.price, { amount: 164.08, currency: 'EUR' });
  assert.equal(flight.source, 'duffel');
});

test('refundability remains unknown when Duffel omits fare conditions', () => {
  const [flight] = normalizeDuffelOffers([{ ...OFFER, conditions: undefined }]);
  assert.equal(flight.refundable, undefined);
});

// Booking needs it; the Sabre shape has no equivalent field.
test('the offer id is carried through so the option stays bookable', () => {
  const [flight] = normalizeDuffelOffers([OFFER]);
  assert.equal(flight.offerId, 'off_0000B9jb9FgNezPosg');
  assert.equal(flight.expiresAt, '2026-08-25T13:00:00Z');
});

test('segment times are stripped of any zone so the shared parser reads them', () => {
  const [flight] = normalizeDuffelOffers([{
    ...OFFER,
    slices: [{
      ...OFFER.slices[0],
      segments: [{ ...OFFER.slices[0].segments[0], departing_at: '2026-09-24T17:48:00Z' }],
    }],
  }]);
  assert.equal(flight.segments[0].departureTime, '2026-09-24T17:48:00');
});

test('IANA zone names become the numeric offsets the physics check needs', () => {
  const [flight] = normalizeDuffelOffers([OFFER]);
  assert.equal(flight.segments[0].departureOffsetHours, -4); // EDT
  assert.equal(flight.segments[0].arrivalOffsetHours, -7);   // PDT
});

// The whole point of normalizing to one shape.
test('a normalized Duffel offer passes the plausibility filter unchanged', () => {
  const [flight] = normalizeDuffelOffers([OFFER]);
  assert.equal(assessItinerary(flight).plausible, true);
});

test('a normalized Duffel offer can be scored against a Sabre-shaped original', () => {
  const [flight] = normalizeDuffelOffers([OFFER]);
  const { total, breakdown } = scoreOption(flight, {
    original: {
      airline: 'ZZ', cabin: 'ECONOMY', stops: 0,
      arrivalTime: '2026-09-24T20:53:00', arrivalOffsetHours: -7,
      price: { amount: 164.08, currency: 'EUR' },
    },
  });
  assert.equal(total, 0, 'an identical offer must score zero regardless of provider');
  assert.ok(Array.isArray(breakdown));
});

test('an offer with no segments is dropped rather than crashing', () => {
  assert.deepEqual(normalizeDuffelOffers([{ id: 'x', slices: [] }]), []);
  assert.deepEqual(normalizeDuffelOffers([]), []);
});

test('ISO 8601 durations convert to minutes', () => {
  assert.equal(isoDurationToMinutes('PT6H5M'), 365);
  assert.equal(isoDurationToMinutes('PT45M'), 45);
  assert.equal(isoDurationToMinutes('P1DT2H'), 1560);
  assert.equal(isoDurationToMinutes('garbage'), null);
  assert.equal(isoDurationToMinutes(undefined), null);
});

test('an unknown timezone does not throw', () => {
  assert.equal(hoursFromZone('Not/AZone', '2026-09-24T17:48:00Z'), undefined);
  assert.equal(hoursFromZone(undefined, '2026-09-24T17:48:00Z'), undefined);
});

// --- seat map ---------------------------------------------------------

const SEAT_MAP = [{
  cabins: [{
    cabin_class: 'economy',
    rows: [
      { sections: [{ elements: [
        { type: 'seat', designator: '28A', available_services: [] },
        { type: 'seat', designator: '28C', available_services: [{ total_amount: '12.00', total_currency: 'EUR' }] },
        { type: 'exit_row', designator: null },
      ] }] },
      { sections: [{ elements: [{ type: 'bassinet' }] }] },
    ],
  }],
}];

test('a seat map flattens to rows with availability and price', () => {
  const map = normalizeSeatMap(SEAT_MAP);
  assert.equal(map.cabinClass, 'economy');
  assert.equal(map.totalSeats, 2);
  assert.equal(map.availableSeats, 1);
  assert.equal(map.rows.length, 1, 'a row with no seats is not rendered');
  assert.equal(map.rows[0].seats[0].available, false);
  assert.deepEqual(map.rows[0].seats[1].price, { amount: 12, currency: 'EUR' });
});

test('an empty seat map is reported, not thrown', () => {
  const map = normalizeSeatMap([]);
  assert.deepEqual(map, { cabinClass: null, rows: [], totalSeats: 0, availableSeats: 0 });
});
