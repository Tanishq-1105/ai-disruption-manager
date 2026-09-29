import { Router } from 'express';
import { provider } from '../providers/index.js';
import { detectDisruptions } from '../agent/detection.js';
import { analyseImpact } from '../agent/impact.js';
import { DEMO_TRIP_ID, buildDemoTrip } from '../simulator/demoTrip.js';
import { runRecovery } from '../agent/recovery.js';
import { DEFAULT_POLICY } from '../agent/policy.js';
import { config } from '../config.js';
import * as flightSearch from '../providers/search.js';
import * as audit from '../store/audit.js';
import * as memberTrips from '../store/memberTrips.js';
import { HttpError } from '../errors.js';

// The judge-facing control panel: seed a trip, then hit cancel / delay / fail
// to trigger a disruption live during the demo.
const router = Router();

function flightQuery(req) {
  const airline = typeof req.query.airline === 'string' ? req.query.airline.trim().toUpperCase() : '';
  const flightNumber = typeof req.query.flightNumber === 'string' ? req.query.flightNumber.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{2,3}$/.test(airline) || !/^[A-Z0-9]{3,8}$/.test(flightNumber)
      || !flightNumber.startsWith(airline)) {
    throw new HttpError(400, 'INVALID_FLIGHT',
      'Provide airline and flightNumber, for example airline=ZZ&flightNumber=ZZ123');
  }
  return { airline, flightNumber };
}

function validateFlightValues(airline, flightNumber) {
  if (!/^[A-Z0-9]{2,3}$/.test(airline) || !/^[A-Z0-9]{3,8}$/.test(flightNumber)
      || !flightNumber.startsWith(airline)) {
    throw new HttpError(400, 'INVALID_FLIGHT',
      'Provide airline and flightNumber, for example airline=ZZ and flightNumber=ZZ123.');
  }
  return { airline, flightNumber };
}

function publicMemberTrip(record) {
  return {
    id: record.id,
    status: record.status,
    sandbox: true,
    orderId: record.orderId,
    bookingReference: record.bookingReference ?? null,
    passengerName: record.passenger ? `${record.passenger.given_name} ${record.passenger.family_name}` : null,
    flight: record.quote.flight,
    total: record.total ?? record.quote.total,
    createdAt: record.createdAt,
  };
}

router.post('/trips/:tripId/seed', (req, res) => {
  const trip = provider.seedTrip(req.params.tripId, req.body.nodes || []);
  res.status(201).json(trip);
});

// One-click fixture: outbound leg -> connecting leg -> hotel -> ground,
// plus a commitment, so the control panel has a realistic chain to break.
router.post('/demo/seed', (req, res) => {
  const trip = provider.seedTrip(DEMO_TRIP_ID, buildDemoTrip());
  res.status(201).json(trip);
});

router.post('/trips/:tripId/nodes/:nodeId/cancel', (req, res, next) => {
  try {
    res.json(provider.cancelNode(req.params.tripId, req.params.nodeId));
  } catch (err) {
    next(err);
  }
});

router.post('/trips/:tripId/flights/:flightId/delay', (req, res, next) => {
  try {
    const minutes = Number(req.body.minutes);
    res.json(provider.delayFlight(req.params.tripId, req.params.flightId, minutes));
  } catch (err) {
    next(err);
  }
});

router.post('/bookings/fail-next', (req, res) => {
  provider.setForceNextBookingFailure(true);
  res.status(204).end();
});

router.get('/member-bookings', async (req, res, next) => {
  try {
    const query = flightQuery(req);
    const records = await memberTrips.listConfirmedByFlight(query);
    res.json({ query, count: records.length, results: records.map(publicMemberTrip) });
  } catch (err) {
    next(err);
  }
});

router.post('/member-bookings/disrupt', async (req, res, next) => {
  try {
    const airline = typeof req.body?.airline === 'string' ? req.body.airline.trim().toUpperCase() : '';
    const flightNumber = typeof req.body?.flightNumber === 'string'
      ? req.body.flightNumber.trim().toUpperCase() : '';
    const type = req.body?.type ?? 'CANCELLED';
    const minutes = Number(req.body?.minutes);
    if (!/^[A-Z0-9]{2,3}$/.test(airline) || !/^[A-Z0-9]{3,8}$/.test(flightNumber)
        || !flightNumber.startsWith(airline) || !['CANCELLED', 'DELAYED'].includes(type)
        || (type === 'DELAYED' && (!Number.isFinite(minutes) || minutes <= 0))) {
      throw new HttpError(400, 'INVALID_DISRUPTION',
        'Provide a valid airline, flightNumber, and disruption type.');
    }
    const records = await memberTrips.listConfirmedByFlight({ airline, flightNumber });
    const affected = records.map(record => {
      const flight = record.quote.flight;
      const simulatorTripId = `member-trip-${record.id}`;
      const nodeId = `member-flight-${record.id}`;
      const trip = provider.seedTrip(simulatorTripId, [{
        id: nodeId, type: 'FLIGHT', status: 'CONFIRMED', bookingId: record.orderId,
        origin: flight.origin, destination: flight.destination, airline: flight.airline,
        flightNumber: flight.flightNumber, cabin: flight.cabin, price: record.total ?? record.quote.total,
        stops: flight.stops, durationMinutes: flight.durationMinutes,
        segments: structuredClone(flight.segments ?? []),
        scheduledDeparture: flight.departureTime, scheduledArrival: flight.arrivalTime, dependsOn: [],
      }]);
      const node = type === 'CANCELLED'
        ? provider.cancelNode(simulatorTripId, nodeId)
        : provider.delayFlight(simulatorTripId, nodeId, minutes);
      return {
        memberTripId: record.id, simulatorTripId, nodeId,
        passengerName: record.passenger ? `${record.passenger.given_name} ${record.passenger.family_name}` : null,
        orderId: record.orderId, disruption: { type, minutes: type === 'DELAYED' ? minutes : null },
        node, trip,
      };
    });

    res.json({ query: { airline, flightNumber }, affectedCount: affected.length, affected });
  } catch (err) {
    next(err);
  }
});

router.post('/member-bookings/recover', async (req, res, next) => {
  try {
    const airline = typeof req.body?.airline === 'string' ? req.body.airline.trim().toUpperCase() : '';
    const flightNumber = typeof req.body?.flightNumber === 'string'
      ? req.body.flightNumber.trim().toUpperCase() : '';
    validateFlightValues(airline, flightNumber);
    const ids = Array.isArray(req.body?.memberTripIds) ? req.body.memberTripIds : [];
    if (ids.length === 0 || ids.length > 100 || ids.some(id => typeof id !== 'string')) {
      throw new HttpError(400, 'INVALID_RECOVERY_REQUEST',
        'memberTripIds must contain between 1 and 100 saved trip IDs.');
    }
    const results = [];
    for (const memberTripId of [...new Set(ids)]) {
      const records = await memberTrips.listConfirmedByFlight({
        airline,
        flightNumber,
      });
      const record = records.find(entry => entry.id === memberTripId);
      if (!record) {
        results.push({ memberTripId, status: 'SKIPPED', detail: 'confirmed matching member trip not found' });
        continue;
      }
      const simulatorTripId = `member-trip-${record.id}`;
      try {
        provider.getTrip(simulatorTripId);
      } catch {
        results.push({ memberTripId, status: 'SKIPPED', detail: 'simulate the disruption before recovery' });
        continue;
      }
      const recovery = await runRecovery({
        tripId: simulatorTripId,
        provider,
        policy: { ...DEFAULT_POLICY, costCap: config.policy.costCap },
        maxAttempts: 6,
        searchReplacements: async ({ origin, destination, departureDate }) => {
          try {
            const { results: options } = await flightSearch.searchFlights({
              origin, destination, departuredate: departureDate,
            });
            return options;
          } catch (error) {
            console.warn(`[member-recover] replacement search failed: ${error.message}`);
            return [];
          }
        },
      });
      const persistence = await audit.recordEntries(recovery.audit, { tripId: memberTripId });
      const recoveryRow = recovery.recoveries[0];
      const execution = recoveryRow?.execution;
      if (execution?.bookingId && execution.status?.startsWith('RECOVERED')) {
        const booking = provider.getBooking(execution.bookingId);
        const flight = execution.option;
        await memberTrips.update(record.userId, record.id, ['CONFIRMED'], {
          status: 'CONFIRMED',
          orderId: booking.id,
          bookingReference: booking.bookingReference ?? null,
          quote: { ...record.quote, offerId: flight.offerId ?? flight.id, flight, expiresAt: null },
          total: booking.total,
          message: recoveryRow.message?.body ?? null,
        }, 'AUTOMATIC_RECOVERY_APPLIED', 'AUTOMATIC_POLICY');
      }
      results.push({
        memberTripId, passengerName: record.passenger
          ? `${record.passenger.given_name} ${record.passenger.family_name}` : null,
        status: execution?.status ?? 'NO_RESULT',
        recoveryId: persistence.recoveryId,
        auditPersisted: persistence.persisted,
        result: recovery,
      });
    }
    res.json({ count: results.length, results });
  } catch (err) {
    next(err);
  }
});

// Runs the Watcher (Phase 2) then the Impact Analyser (Phase 3) against the
// trip's current state — what the control panel polls to show live results.
router.get('/trips/:tripId/analyse', (req, res, next) => {
  try {
    const trip = provider.getTrip(req.params.tripId);
    const events = detectDisruptions(trip);
    const impacts = events.map((event) => ({ event, impact: analyseImpact(trip, event) }));
    res.json({ events, impacts });
  } catch (err) {
    next(err);
  }
});

// Runs the whole loop: detect -> assess -> search real alternatives -> score ->
// apply policy -> book safely. This is the endpoint that makes the "Force next
// booking failure" button meaningful: arm it, then recover, and watch the agent
// keep the old ticket and fall through to the next candidate.
router.post('/trips/:tripId/recover', async (req, res, next) => {
  try {
    const result = await runRecovery({
      tripId: req.params.tripId,
      provider,
      // Policy stays a pure module; the environment-specific cap is injected
      // here rather than read inside it.
      policy: { ...DEFAULT_POLICY, costCap: config.policy.costCap },
      // Live offers go stale; with duplicates collapsed each attempt is a
      // genuinely different flight, so a slightly larger budget is worth it.
      maxAttempts: 6,
      // Injected so the agent core never reaches for Sabre itself. Real search,
      // normalized and plausibility-filtered; an empty list on any failure so a
      // provider outage degrades to "escalate" rather than crashing the demo.
      searchReplacements: async ({ origin, destination, departureDate }) => {
        try {
          const { results } = await flightSearch.searchFlights({
            origin, destination, departuredate: departureDate,
          });
          return results;
        } catch (err) {
          console.warn(`[recover] replacement search failed: ${err.message}`);
          return [];
        }
      },
    });
    // Persist the trail. Best-effort by design: a failed audit write must not
    // turn a successful rebooking into an HTTP error, so the outcome is
    // reported in the response instead of thrown.
    const persistence = await audit.recordEntries(result.audit, { tripId: req.params.tripId });
    if (!persistence.persisted && result.audit.length > 0) {
      console.warn(`[recover] audit write failed: ${persistence.error}`);
    }

    res.json({ ...result, recoveryId: persistence.recoveryId, auditPersisted: persistence.persisted });
  } catch (err) {
    next(err);
  }
});

// The durable trail, so "we can show exactly what the agent did and why" is
// verifiable after the request that did it has gone.
router.get('/trips/:tripId/audit', async (req, res, next) => {
  try {
    res.json({ tripId: req.params.tripId, entries: await audit.listByTrip(req.params.tripId) });
  } catch (err) {
    next(err);
  }
});

router.get('/audit', async (req, res, next) => {
  try {
    res.json({ entries: await audit.listRecent({ limit: Number(req.query.limit) || 100 }) });
  } catch (err) {
    next(err);
  }
});

router.get('/state', (req, res) => {
  res.json(provider.getState());
});

export default router;
