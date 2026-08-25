// Physical plausibility checks for flight segments.
//
// Sabre's CERT cache serves itineraries that are internally consistent yet
// physically impossible. The one that motivated this module:
//
//   FLL-LAX  dep 22:30 (GMT-4)  arr 20:00 (GMT-7)  ElapsedTime 30
//
// The timestamps, the timezone offsets and ElapsedTime all agree with each
// other — 30 minutes really is the gap once you convert to UTC. It is simply
// not possible to fly ~3,800km in half an hour. So a self-consistency check
// catches nothing here; the test has to be against physics.
//
// Rather than ship an airport coordinate table, we use the timezone offsets
// the feed already carries. One hour of GMT offset is 15 degrees of longitude,
// which is roughly 1,250km at mid latitudes — about 85 minutes of jet cruise.
// The floor below is deliberately far more generous than that so legitimate
// fast transcontinental flights never trip it; it exists to catch the absurd,
// not to second-guess real schedules.
//
// Pure by design: no network, no clock, no vendor schema. It takes the
// normalized segment shape, so a future Duffel or AeroDataBox adapter gets the
// same protection for free.

// A scheduled jet segment shorter than this is not a real commercial flight.
export const MIN_SEGMENT_MINUTES = 20;

// Minimum minutes of flight per hour of timezone difference. True cruise cost
// is ~85; 45 leaves a wide margin for tailwinds and generous rounding.
export const MINUTES_PER_TZ_HOUR = 45;

// Below this, connections are not survivable in a real airport.
export const MIN_CONNECTION_MINUTES = 20;

// Local wall-clock times mean nothing across timezones — every comparison has
// to happen in UTC, which is what silently corrupted the raw feed's own
// arithmetic in the first place.
//
// Two ISO flavours reach this function and mixing them up is silent: Sabre
// sends bare local time ("2026-09-24T20:00:00") that needs the companion
// offset, while the simulator's trip nodes already carry a zone
// ("2026-09-24T17:00:00Z"). Blindly appending Z to the second produces "ZZ"
// and NaN, which surfaced downstream as "arrival times are not comparable"
// and made every real candidate look unauthorised.
const HAS_EXPLICIT_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

export function toUtcMinutes(iso, offsetHours) {
  if (typeof iso !== 'string' || iso.length === 0) return null;

  if (HAS_EXPLICIT_ZONE.test(iso)) {
    // The string already states its zone, so any offset argument is redundant.
    const parsed = Date.parse(iso);
    return Number.isNaN(parsed) ? null : parsed / 60000;
  }

  const parsed = Date.parse(`${iso}Z`);
  if (Number.isNaN(parsed)) return null;
  const offset = Number.isFinite(offsetHours) ? offsetHours : 0;
  return parsed / 60000 - offset * 60;
}

export function segmentIssues(segment) {
  const issues = [];
  const depUtc = toUtcMinutes(segment.departureTime, segment.departureOffsetHours);
  const arrUtc = toUtcMinutes(segment.arrivalTime, segment.arrivalOffsetHours);

  if (depUtc === null || arrUtc === null) {
    issues.push('unparseable segment times');
    return issues;
  }

  const actualMinutes = arrUtc - depUtc;
  if (actualMinutes <= 0) {
    issues.push(`segment arrives ${-actualMinutes}min before it departs`);
    return issues;
  }
  if (actualMinutes < MIN_SEGMENT_MINUTES) {
    issues.push(`segment lasts ${actualMinutes}min, below the ${MIN_SEGMENT_MINUTES}min floor`);
  }

  // Only meaningful for east-west travel. A north-south segment has no
  // timezone delta, so this contributes nothing and never false-positives.
  const tzHours = Math.abs(
    (segment.arrivalOffsetHours ?? 0) - (segment.departureOffsetHours ?? 0),
  );
  const impliedMinimum = tzHours * MINUTES_PER_TZ_HOUR;
  if (tzHours > 0 && actualMinutes < impliedMinimum) {
    issues.push(
      `${segment.origin}-${segment.destination} crosses ${tzHours}h of timezones in ${actualMinutes}min, ` +
      `under the ${impliedMinimum}min minimum`,
    );
  }

  // A stated duration that disagrees with the timestamps means one of the two
  // is wrong, and we cannot tell which — so the itinerary is not trustworthy.
  if (Number.isFinite(segment.durationMinutes) && segment.durationMinutes > 0) {
    const drift = Math.abs(segment.durationMinutes - actualMinutes);
    if (drift > 5) {
      issues.push(
        `stated duration ${segment.durationMinutes}min disagrees with timestamps (${actualMinutes}min)`,
      );
    }
  }

  return issues;
}

export function assessItinerary(itinerary) {
  const issues = [];
  const segments = itinerary?.segments ?? [];

  if (segments.length === 0) {
    return { plausible: false, issues: ['itinerary has no segments'] };
  }

  segments.forEach((segment, index) => {
    for (const issue of segmentIssues(segment)) {
      issues.push(`segment ${index + 1}: ${issue}`);
    }
  });

  // Connections must be survivable and in order.
  for (let i = 1; i < segments.length; i += 1) {
    const prevArrival = toUtcMinutes(segments[i - 1].arrivalTime, segments[i - 1].arrivalOffsetHours);
    const nextDeparture = toUtcMinutes(segments[i].departureTime, segments[i].departureOffsetHours);
    if (prevArrival === null || nextDeparture === null) continue;

    const layover = nextDeparture - prevArrival;
    if (layover < 0) {
      issues.push(`connection ${i}: departs ${-layover}min before the inbound arrives`);
    } else if (layover < MIN_CONNECTION_MINUTES) {
      issues.push(`connection ${i}: only ${layover}min on the ground`);
    }
  }

  return { plausible: issues.length === 0, issues };
}

// Splits rather than discards: the caller decides what to do with the bad
// ones, and the demo can still show that the filter is doing something.
export function partitionByPlausibility(itineraries) {
  const kept = [];
  const rejected = [];
  for (const itinerary of itineraries) {
    const assessment = assessItinerary(itinerary);
    if (assessment.plausible) kept.push(itinerary);
    else rejected.push({ itinerary, issues: assessment.issues });
  }
  return { kept, rejected };
}
