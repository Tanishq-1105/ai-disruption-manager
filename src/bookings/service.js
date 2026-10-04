import { createHash, randomUUID } from 'node:crypto';
import { BookingError } from './errors.js';
import * as recoveryAttempts from '../store/recoveryAttempts.js';

const ACTIVE = ['BOOKING', 'PENDING', 'REVIEW_REQUIRED'];
const ID = /^[a-zA-Z0-9_-]{8,100}$/;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function validatePassenger(input, quote) {
  const fail = message => { throw new BookingError(400, 'INVALID_PASSENGER', message); };
  const passenger = {};
  for (const key of ['given_name', 'family_name', 'email', 'phone_number', 'born_on', 'title', 'gender']) {
    if (typeof input?.[key] !== 'string') fail('Complete all passenger details.');
    passenger[key] = input[key].trim();
  }
  for (const key of ['given_name', 'family_name']) {
    if (!/^[\p{L}\p{M} '\u2019-]{1,80}$/u.test(passenger[key])) fail('Enter the passenger’s first and last names.');
  }
  passenger.email = passenger.email.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(passenger.email) || passenger.email.length > 254) fail('Enter a valid email.');
  if (!/^\+[1-9]\d{7,14}$/.test(passenger.phone_number)) fail('Use an international phone number, for example +442080160509.');
  if (!['mr', 'ms', 'mrs', 'miss', 'dr'].includes(passenger.title)) fail('Select a passenger title.');
  if (!['m', 'f'].includes(passenger.gender)) fail('Select the airline passenger gender.');
  const departureDay = quote.flight.departureTime.slice(0, 10);
  const adultCutoff = `${Number(departureDay.slice(0, 4)) - 18}${departureDay.slice(4)}`;
  if (!validDate(passenger.born_on) || passenger.born_on < '1900-01-01' || passenger.born_on > adultCutoff) {
    fail('Enter a valid date of birth (YYYY-MM-DD) for an adult aged 18 or older.');
  }
  if (quote.requiresPassport) {
    const document = input.passport;
    if (!document || typeof document.number !== 'string' || !/^[A-Z0-9]{5,20}$/i.test(document.number)
        || typeof document.country !== 'string' || !/^[A-Z]{2}$/.test(document.country) || !validDate(document.expiresOn)
        || document.expiresOn <= quote.flight.arrivalTime.slice(0, 10)) {
      fail('This flight requires a passport number, two-letter country code, and a valid expiry date.');
    }
    passenger.identity_documents = [{ type: 'passport', unique_identifier: document.number.toUpperCase(),
      issuing_country_code: document.country, expires_on: document.expiresOn }];
  }
  return passenger;
}

function offerSignature(quote) {
  // Expiry can extend on refresh. Price, flights, cabin, and required documents
  // cannot change without another explicit confirmation from the member.
  const { price, expiresAt, _index, ...flight } = quote.flight;
  return hash({ total: quote.total, flight, requiresPassport: quote.requiresPassport });
}

export function publicTrip(record) {
  if (!record) return null;
  return {
    id: record.id, version: record.version, status: record.status, sandbox: true, provider: 'duffel',
    flight: record.quote.flight, total: record.total ?? record.quote.total,
    expiresAt: record.quote.expiresAt, requiresPassport: record.quote.requiresPassport,
    orderId: record.orderId ?? null, bookingReference: record.bookingReference ?? null,
    passengerName: record.passenger ? `${record.passenger.given_name} ${record.passenger.family_name}` : null,
    createdAt: record.createdAt, message: record.message ?? null,
  };
}

export function createBookingService({ provider, store }) {
  function supported() {
    if (!provider.getFlightQuote || !provider.createMemberOrder || !provider.findMemberOrder) {
      throw new BookingError(503, 'SANDBOX_UNAVAILABLE', 'Flight booking requires the Duffel sandbox provider.');
    }
  }

  async function owned(userId, id) {
    if (typeof id !== 'string' || !ID.test(id)) throw new BookingError(400, 'INVALID_REQUEST', 'Invalid booking ID.');
    const record = await store.getById(userId, id);
    if (!record) throw new BookingError(404, 'TRIP_NOT_FOUND', 'Trip not found.');
    return record;
  }

  async function simulateDisruption({
    userId, id, type = 'CANCELLED', minutes, source = 'MEMBER_SIMULATION', expectedOrderId,
  }) {
    const record = await owned(userId, id);
    if (expectedOrderId && record.orderId !== expectedOrderId) {
      throw new BookingError(409, 'TRIP_CHANGED', 'The saved booking changed while the disruption was being checked.');
    }
    if (record.status !== 'CONFIRMED' || !record.orderId) {
      throw new BookingError(409, 'TRIP_NOT_CONFIRMED', 'Only a confirmed sandbox trip can be disrupted.');
    }
    if (!['CANCELLED', 'DELAYED'].includes(type)) {
      throw new BookingError(400, 'INVALID_DISRUPTION', 'type must be CANCELLED or DELAYED.');
    }
    if (type === 'DELAYED' && (!Number.isFinite(minutes) || minutes <= 0)) {
      throw new BookingError(400, 'INVALID_DELAY', 'minutes must be a positive number.');
    }

    const flight = record.quote.flight;
    const disruption = { type, minutes: type === 'DELAYED' ? minutes : null };
    const recoveryAttempt = await recoveryAttempts.createSimulationAttempt({
      memberTripId: record.id,
      userId,
      originalOrderId: record.orderId,
      flight,
      disruption,
      source,
    });
    if (['DUFFEL_POLL', 'LOCAL_POLL_TEST'].includes(source)
        && recoveryAttempt.state !== 'DISRUPTION_DETECTED') {
      return {
        tripId: record.id,
        recoveryId: recoveryAttempt.id,
        disruption,
        alreadyHandled: true,
        recoveryState: recoveryAttempt.state,
      };
    }
    const simulatorTripId = `member-trip-${record.id}`;
    const nodeId = `member-flight-${record.id}`;
    const trip = provider.seedTrip(simulatorTripId, [{
      id: nodeId,
      type: 'FLIGHT',
      status: 'CONFIRMED',
      bookingId: record.orderId,
      origin: flight.origin,
      destination: flight.destination,
      airline: flight.airline,
      flightNumber: flight.flightNumber,
      cabin: flight.cabin,
      price: record.total ?? record.quote.total,
      refundable: flight.refundable,
      departureOffsetHours: flight.segments?.[0]?.departureOffsetHours,
      arrivalOffsetHours: flight.segments?.at(-1)?.arrivalOffsetHours,
      stops: flight.stops,
      durationMinutes: flight.durationMinutes,
      segments: structuredClone(flight.segments ?? []),
      scheduledDeparture: flight.departureTime,
      scheduledArrival: flight.arrivalTime,
      dependsOn: [],
    }]);

    const node = type === 'CANCELLED'
      ? provider.cancelNode(simulatorTripId, nodeId)
      : provider.delayFlight(simulatorTripId, nodeId, minutes);

    return {
      tripId: record.id,
      simulatorTripId,
      recoveryId: recoveryAttempt.id,
      disruption,
      node,
      simulatorTrip: trip,
    };
  }

  async function freshQuote(offerId) {
    supported();
    try { return await provider.getFlightQuote(offerId); }
    catch (error) {
      if (error instanceof BookingError) throw error;
      if ([404, 410, 422].includes(error.status)) {
        throw new BookingError(410, 'OFFER_EXPIRED', 'This offer is no longer available. Search for a fresh flight.');
      }
      throw new BookingError(503, 'PROVIDER_UNAVAILABLE', 'Could not refresh this flight. Please try again.');
    }
  }

  async function quote({ userId, offerId }) {
    if (typeof offerId !== 'string' || !/^off_[a-zA-Z0-9]{1,100}$/.test(offerId)) {
      throw new BookingError(400, 'INVALID_OFFER', 'Choose a Duffel flight offer.');
    }
    const existing = await store.getByOffer(userId, offerId);
    if (existing && existing.status !== 'QUOTED') return publicTrip(existing);
    return publicTrip(await store.saveQuote(userId, await freshQuote(offerId)));
  }

  async function reconcile(record) {
    if (!ACTIVE.includes(record.status)) return record;
    supported();
    try {
      const order = await provider.findMemberOrder({ orderId: record.orderId, offerId: record.offerId, id: record.id });
      if (!order) return record;
      return await store.update(record.userId, record.id, ACTIVE, {
        ...order, message: order.status === 'CONFIRMED' ? null : 'The airline has not confirmed this booking yet.',
      }, order.status === 'CONFIRMED' ? 'BOOKING_CONFIRMED' : 'ORDER_CHECKED');
    } catch {
      // A failed read is not permission to create another order.
      return record;
    }
  }

  async function book({ userId, quoteId, version, passenger: input, idempotencyKey }) {
    let record = await owned(userId, quoteId);
    if (idempotencyKey !== quoteId) throw new BookingError(400, 'IDEMPOTENCY_REQUIRED', 'Use the quote ID as the Idempotency-Key.');
    const passenger = validatePassenger(input, record.quote);
    const fingerprint = hash(passenger);
    if (record.status !== 'QUOTED') {
      if (record.fingerprint !== fingerprint) throw new BookingError(409, 'BOOKING_CONFLICT', 'This booking request was already used for another passenger.');
      return publicTrip(await reconcile(record));
    }
    if (version !== record.version) throw new BookingError(409, 'QUOTE_CHANGED', 'Review the latest fare before confirming.', { quote: publicTrip(record) });

    record = await store.claim(userId, quoteId, version, passenger, fingerprint);
    if (!record) {
      const current = await owned(userId, quoteId);
      if (current.status === 'QUOTED') throw new BookingError(409, 'QUOTE_CHANGED', 'Review the latest fare before confirming.', { quote: publicTrip(current) });
      if (current.fingerprint !== fingerprint) throw new BookingError(409, 'BOOKING_CONFLICT', 'This booking request is already in use.');
      return publicTrip(current);
    }

    let refreshed;
    try { refreshed = await freshQuote(record.offerId); }
    catch (error) {
      // No order POST has happened. It is safe to return to the review step.
      await store.update(userId, quoteId, ['BOOKING'], { status: 'QUOTED' }, 'OFFER_REFRESH_FAILED');
      throw error;
    }
    if (offerSignature(refreshed) !== offerSignature(record.quote)) {
      const updated = await store.update(userId, quoteId, ['BOOKING'], {
        status: 'QUOTED', quote: refreshed, version: randomUUID(),
      }, 'QUOTE_CHANGED');
      throw new BookingError(409, 'QUOTE_CHANGED', 'The fare or itinerary changed. Review it and confirm again.', { quote: publicTrip(updated) });
    }

    try {
      const order = await provider.createMemberOrder({ quote: refreshed, passenger, idempotencyKey: quoteId });
      record = await store.update(userId, quoteId, ['BOOKING', 'REVIEW_REQUIRED'], {
        status: 'PENDING', orderId: order.id, message: 'Checking your booking with the airline.',
      }, 'ORDER_CREATED');
    } catch (error) {
      const rejected = [400, 402, 404, 410, 422].includes(error.status)
        && !['offer_request_already_booked', 'offer_already_booked'].includes(error.duffelCode);
      record = await store.update(userId, quoteId, ['BOOKING'], {
        status: rejected ? 'FAILED' : 'REVIEW_REQUIRED',
        message: rejected ? 'The airline could not book this flight. Search again for another offer.'
          : 'The booking outcome needs checking. Do not book again; use Check status.',
      }, rejected ? 'ORDER_REJECTED' : 'ORDER_OUTCOME_UNKNOWN');
    }
    return publicTrip(await reconcile(record));
  }

  return {
    quote, book,
    simulateDisruption,
    list: async userId => (await store.listByUser(userId)).map(publicTrip),
    ensureOwned: async (userId, id) => { await owned(userId, id); },
    get: async (userId, id) => publicTrip(await reconcile(await owned(userId, id))),
    track: async (userId, id) => {
      const record = await reconcile(await owned(userId, id));
      if (!record.orderId) throw new BookingError(409, 'BOOKING_PENDING', 'This trip has no confirmed order to track yet. Check its booking status.');
      if (!provider.trackMemberOrder) throw new BookingError(503, 'TRACKING_UNAVAILABLE', 'Duffel booking tracking is unavailable.');
      const tracking = await provider.trackMemberOrder({ orderId: record.orderId, id: record.id });
      // Reading changes does not accept them or change the member's itinerary.
      await store.update(userId, id, ['CONFIRMED', ...ACTIVE], {
        status: tracking.bookingStatus, bookingReference: tracking.bookingReference, lastCheckedAt: tracking.checkedAt,
      });
      return { ...tracking, tripId: id, flight: tracking.flight ?? record.quote.flight };
    },
  };
}
