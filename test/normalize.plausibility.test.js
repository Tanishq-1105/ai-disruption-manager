import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toUtcMinutes,
  segmentIssues,
  assessItinerary,
  partitionByPlausibility,
} from '../src/normalize/plausibility.js';

// Captured live from InstaFlights (JFK->LAX, 2026-09-23). Internally
// consistent and completely impossible: ~3,800km in half an hour.
const CORRUPT_FLL_LAX = {
  airline: 'B6',
  flightNumber: '3628',
  origin: 'FLL',
  destination: 'LAX',
  departureTime: '2026-09-24T22:30:00',
  arrivalTime: '2026-09-24T20:00:00',
  departureOffsetHours: -4,
  arrivalOffsetHours: -7,
  durationMinutes: 30,
};

// Also captured live, and entirely reasonable.
const GOOD_JFK_LAX = {
  airline: 'DL',
  flightNumber: '742',
  origin: 'JFK',
  destination: 'LAX',
  departureTime: '2026-09-23T07:00:00',
  arrivalTime: '2026-09-23T10:00:00',
  departureOffsetHours: -4,
  arrivalOffsetHours: -7,
  durationMinutes: 360,
};

const GOOD_JFK_FLL = {
  airline: 'B6',
  flightNumber: '3226',
  origin: 'JFK',
  destination: 'FLL',
  departureTime: '2026-09-24T19:30:00',
  arrivalTime: '2026-09-24T21:35:00',
  departureOffsetHours: -4,
  arrivalOffsetHours: -4,
  durationMinutes: 125,
};

test('toUtcMinutes normalises local wall clock by its offset', () => {
  // 22:30 at GMT-4 is 02:30 UTC the next day.
  const a = toUtcMinutes('2026-09-24T22:30:00', -4);
  const b = toUtcMinutes('2026-09-25T02:30:00', 0);
  assert.equal(a, b);
});

test('toUtcMinutes returns null rather than NaN for junk input', () => {
  assert.equal(toUtcMinutes(undefined, -4), null);
  assert.equal(toUtcMinutes('not-a-date', -4), null);
});

test('a missing offset is treated as UTC rather than throwing', () => {
  assert.equal(toUtcMinutes('2026-09-24T22:30:00'), Date.parse('2026-09-24T22:30:00Z') / 60000);
});

// The whole reason this module exists.
test('the real corrupt FLL-LAX segment is rejected', () => {
  const issues = segmentIssues(CORRUPT_FLL_LAX);
  assert.ok(issues.length > 0);
  assert.match(issues.join(' '), /timezones/);
});

test('a self-consistent segment is still caught, because the test is physics', () => {
  // Timestamps, offsets and durationMinutes all agree with each other here —
  // only the implied ground speed gives it away.
  const issues = segmentIssues(CORRUPT_FLL_LAX);
  assert.equal(issues.some((i) => /disagrees with timestamps/.test(i)), false);
  assert.ok(issues.some((i) => /under the .*minimum/.test(i)));
});

test('genuine transcontinental and short-haul segments pass', () => {
  assert.deepEqual(segmentIssues(GOOD_JFK_LAX), []);
  assert.deepEqual(segmentIssues(GOOD_JFK_FLL), []);
});

test('a fast eastbound transcon is not a false positive', () => {
  // LAX->JFK in 5h45, crossing 3 timezones.
  assert.deepEqual(segmentIssues({
    origin: 'LAX', destination: 'JFK',
    departureTime: '2026-09-23T08:00:00', arrivalTime: '2026-09-23T16:45:00',
    departureOffsetHours: -7, arrivalOffsetHours: -4, durationMinutes: 345,
  }), []);
});

test('a north-south segment is judged on the floor alone, not timezones', () => {
  // No timezone delta to reason from, so a plausible short hop passes.
  assert.deepEqual(segmentIssues({
    origin: 'JFK', destination: 'BOS',
    departureTime: '2026-09-23T09:00:00', arrivalTime: '2026-09-23T10:15:00',
    departureOffsetHours: -4, arrivalOffsetHours: -4, durationMinutes: 75,
  }), []);
});

test('a segment arriving before it departs is rejected', () => {
  const issues = segmentIssues({
    origin: 'JFK', destination: 'BOS',
    departureTime: '2026-09-23T10:00:00', arrivalTime: '2026-09-23T09:00:00',
    departureOffsetHours: -4, arrivalOffsetHours: -4, durationMinutes: 60,
  });
  assert.match(issues.join(' '), /before it departs/);
});

test('a stated duration that contradicts the timestamps is rejected', () => {
  const issues = segmentIssues({ ...GOOD_JFK_LAX, durationMinutes: 120 });
  assert.match(issues.join(' '), /disagrees with timestamps/);
});

test('small rounding drift in stated duration is tolerated', () => {
  assert.deepEqual(segmentIssues({ ...GOOD_JFK_LAX, durationMinutes: 363 }), []);
});

test('the real corrupt itinerary is rejected as a whole', () => {
  const { plausible, issues } = assessItinerary({ segments: [GOOD_JFK_FLL, CORRUPT_FLL_LAX] });
  assert.equal(plausible, false);
  assert.match(issues.join(' '), /segment 2/);
});

test('a clean multi-segment itinerary passes', () => {
  const connecting = {
    ...CORRUPT_FLL_LAX,
    arrivalTime: '2026-09-25T01:30:00', // a real ~6h FLL-LAX
    durationMinutes: 360,
  };
  const { plausible } = assessItinerary({ segments: [GOOD_JFK_FLL, connecting] });
  assert.equal(plausible, true);
});

test('an impossible connection is caught even when both segments are fine', () => {
  const tightSecond = {
    ...GOOD_JFK_FLL,
    origin: 'FLL', destination: 'BOS',
    departureTime: '2026-09-24T21:40:00', // 5 minutes after the inbound lands
    arrivalTime: '2026-09-25T00:30:00',
    durationMinutes: 170,
  };
  const { plausible, issues } = assessItinerary({ segments: [GOOD_JFK_FLL, tightSecond] });
  assert.equal(plausible, false);
  assert.match(issues.join(' '), /on the ground/);
});

test('a connection departing before the inbound arrives is caught', () => {
  const impossible = {
    ...GOOD_JFK_FLL,
    origin: 'FLL', destination: 'BOS',
    departureTime: '2026-09-24T20:00:00', // inbound lands 21:35
    arrivalTime: '2026-09-24T23:00:00',
    durationMinutes: 180,
  };
  const { issues } = assessItinerary({ segments: [GOOD_JFK_FLL, impossible] });
  assert.match(issues.join(' '), /before the inbound arrives/);
});

test('an empty itinerary is not silently plausible', () => {
  assert.equal(assessItinerary({ segments: [] }).plausible, false);
  assert.equal(assessItinerary(undefined).plausible, false);
});

test('partitionByPlausibility keeps the good and reports why the bad went', () => {
  const good = { id: 'good', segments: [GOOD_JFK_LAX] };
  const bad = { id: 'bad', segments: [GOOD_JFK_FLL, CORRUPT_FLL_LAX] };
  const { kept, rejected } = partitionByPlausibility([good, bad, good]);

  assert.equal(kept.length, 2);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].itinerary.id, 'bad');
  assert.ok(rejected[0].issues.length > 0);
});

// Found by running the full recovery loop: the simulator's trip nodes carry a
// zone already, Sabre's do not, and appending Z to the former produced "ZZ"
// and a NaN that read downstream as "arrival times are not comparable".
test('an ISO string that already carries Z is parsed, not corrupted', () => {
  assert.equal(
    toUtcMinutes('2026-09-24T17:00:00Z'),
    Date.parse('2026-09-24T17:00:00Z') / 60000,
  );
});

test('an explicit numeric offset is honoured and the argument ignored', () => {
  assert.equal(
    toUtcMinutes('2026-09-24T13:00:00-04:00', 99),
    Date.parse('2026-09-24T17:00:00Z') / 60000,
  );
});

test('zoned and bare forms of the same instant agree', () => {
  assert.equal(
    toUtcMinutes('2026-09-24T17:00:00Z'),
    toUtcMinutes('2026-09-24T13:00:00', -4),
  );
});
