// Maps Duffel offers into the SAME flat shape as src/normalize/flights.js
// produces for Sabre, so the mobile app, the Option Engine and the Policy
// Engine cannot tell which provider an option came from.
//
// Two fields are Duffel-specific and deliberately carried through:
//   offerId  - what POST /air/orders needs to actually book this
//   expiresAt - offers go stale in minutes, which is why the executor's
//               fall-through-to-next-candidate behaviour matters here far more
//               than it does against the simulator.

export function normalizeDuffelOffers(offers = []) {
  return offers.map(normalizeOffer).filter(Boolean);
}

function normalizeOffer(offer, index) {
  const slice = offer?.slices?.[0];
  const rawSegments = slice?.segments ?? [];
  if (rawSegments.length === 0) return null;

  const segments = rawSegments.map(normalizeSegment);
  const first = segments[0];
  const last = segments[segments.length - 1];

  return {
    id: offer.id,
    offerId: offer.id,
    airline: first.airline,
    flightNumber: `${first.airline}${first.flightNumber}`,
    origin: first.origin,
    destination: last.destination,
    departureTime: first.departureTime,
    arrivalTime: last.arrivalTime,
    durationMinutes: isoDurationToMinutes(slice.duration),
    stops: segments.length - 1,
    segments,
    cabin: rawSegments[0]?.passengers?.[0]?.cabin_class?.toUpperCase(),
    refundable: refundableOffer(offer),
    price: {
      amount: Number(offer.total_amount),
      currency: offer.total_currency,
    },
    expiresAt: offer.expires_at ?? null,
    source: 'duffel',
    // Index keeps ids unique if Duffel ever repeats one, matching the Sabre
    // normalizer's reasoning.
    _index: index,
  };
}

function refundableOffer(offer) {
  const condition = offer?.conditions?.refund_before_departure;
  if (condition?.allowed !== true) return condition?.allowed === false ? false : undefined;
  const penalty = Number(condition.penalty_amount ?? 0);
  return Number.isFinite(penalty) && penalty === 0;
}

function normalizeSegment(segment) {
  return {
    airline: segment.marketing_carrier?.iata_code,
    flightNumber: String(segment.marketing_carrier_flight_number ?? ''),
    origin: segment.origin?.iata_code,
    destination: segment.destination?.iata_code,
    // Duffel sends local times WITHOUT a zone suffix, exactly like Sabre, so
    // the plausibility filter and the scorer read them the same way.
    departureTime: stripZone(segment.departing_at),
    arrivalTime: stripZone(segment.arriving_at),
    durationMinutes: isoDurationToMinutes(segment.duration),
    departureOffsetHours: hoursFromZone(segment.origin?.time_zone, segment.departing_at),
    arrivalOffsetHours: hoursFromZone(segment.destination?.time_zone, segment.arriving_at),
  };
}

function stripZone(iso) {
  return typeof iso === 'string' ? iso.replace(/(Z|[+-]\d{2}:?\d{2})$/, '') : iso;
}

// "PT6H30M" -> 390
export function isoDurationToMinutes(duration) {
  if (typeof duration !== 'string') return null;
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?$/.exec(duration);
  if (!match) return null;
  const [, days, hours, minutes] = match;
  const total = Number(days || 0) * 1440 + Number(hours || 0) * 60 + Number(minutes || 0);
  return total > 0 ? total : null;
}

// Duffel gives an IANA zone name rather than a numeric offset, and the offset
// for a given instant is what the plausibility maths needs.
export function hoursFromZone(timeZone, atIso) {
  if (!timeZone || typeof atIso !== 'string') return undefined;
  try {
    const at = new Date(atIso);
    if (Number.isNaN(at.getTime())) return undefined;
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone, timeZoneName: 'longOffset',
    }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value;
    // "GMT-04:00" -> -4
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(formatted ?? '');
    if (!m) return 0;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2]) + Number(m[3]) / 60);
  } catch {
    return undefined;
  }
}

/** Flattens a Duffel seat map into rows of seats the app can render. */
export function normalizeSeatMap(maps = []) {
  const cabin = maps?.[0]?.cabins?.[0];
  if (!cabin) return { cabinClass: null, rows: [], totalSeats: 0, availableSeats: 0 };

  let totalSeats = 0;
  let availableSeats = 0;
  const rows = (cabin.rows ?? []).map((row, rowIndex) => {
    const seats = [];
    for (const section of row.sections ?? []) {
      for (const element of section.elements ?? []) {
        if (element.type !== 'seat') continue;
        const available = Boolean(element.available_services?.length);
        totalSeats += 1;
        if (available) availableSeats += 1;
        const service = element.available_services?.[0];
        seats.push({
          designator: element.designator,
          available,
          price: service ? { amount: Number(service.total_amount), currency: service.total_currency } : null,
        });
      }
    }
    return { row: rowIndex + 1, seats };
  }).filter((r) => r.seats.length > 0);

  return { cabinClass: cabin.cabin_class ?? null, rows, totalSeats, availableSeats };
}
