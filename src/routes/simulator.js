import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { provider } from '../providers/index.js';
import { detectDisruptions } from '../agent/detection.js';
import { analyseImpact } from '../agent/impact.js';
import { DEMO_TRIP_ID, buildDemoTrip } from '../simulator/demoTrip.js';
import { runRecovery } from '../agent/recovery.js';
import { DEFAULT_POLICY, POLICY_VERSION } from '../agent/policy.js';
import { config } from '../config.js';
import * as flightSearch from '../providers/search.js';
import * as audit from '../store/audit.js';
import * as memberTrips from '../store/memberTrips.js';
import * as recoveryAttempts from '../store/recoveryAttempts.js';
import {
  approveLocalMemberRecovery, getMemberRecoveryStatus, prepareMemberApprovalRequest,
} from '../bookings/memberRecovery.js';
import { memberRecoveryMonitor } from '../bookings/memberRecoveryMonitor.js';
import { HttpError } from '../errors.js';

// The judge-facing control panel: seed a trip, then hit cancel / delay / fail
// to trigger a disruption live during the demo.
const router = Router();

export function isLocalBackendTestingRequest(req) {
  return process.env.NODE_ENV !== 'production'
    && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
}

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

function localSandboxRecoveryTestingEnabled(req) {
  return isLocalBackendTestingRequest(req)
    && config.memberRecoveryPolling.enabled
    && config.providers.booking === 'duffel'
    && config.duffel.accessToken?.startsWith('duffel_test_');
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
    const results = await Promise.all(records.map(async record => ({
      ...publicMemberTrip(record),
      recovery: await getMemberRecoveryStatus({ userId: record.userId, memberTripId: record.id }),
    })));
    res.json({
      query,
      count: results.length,
      localApprovalEnabled: isLocalBackendTestingRequest(req),
      localTestDisruptionEnabled: localSandboxRecoveryTestingEnabled(req),
      results,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/member-bookings/all', async (req, res, next) => {
  if (!isLocalBackendTestingRequest(req)) {
    return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  }
  try {
    const afterId = req.query.afterId;
    if (afterId !== undefined && (typeof afterId !== 'string' || !/^[a-f\d]{24}$/i.test(afterId))) {
      throw new HttpError(400, 'INVALID_CURSOR', 'Invalid member bookings page cursor.');
    }
    const limitParam = req.query.limit;
    const rawLimit = limitParam === undefined ? 100
      : typeof limitParam === 'string' ? Number(limitParam) : Number.NaN;
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 200) {
      throw new HttpError(400, 'INVALID_LIMIT', 'Page limit must be an integer from 1 to 200.');
    }

    const records = await memberTrips.listForAdmin({ afterId, limit: rawLimit + 1 });
    const hasMore = records.length > rawLimit;
    const page = hasMore ? records.slice(0, rawLimit) : records;
    const results = await Promise.all(page.map(async record => ({
      ...publicMemberTrip(record),
      recovery: await getMemberRecoveryStatus({ userId: record.userId, memberTripId: record.id }),
    })));
    res.json({
      count: results.length,
      nextCursor: hasMore ? page.at(-1)._id.toHexString() : null,
      localApprovalEnabled: isLocalBackendTestingRequest(req),
      localTestDisruptionEnabled: localSandboxRecoveryTestingEnabled(req),
      results,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/member-bookings/test-disruption', async (req, res, next) => {
  if (!isLocalBackendTestingRequest(req)) {
    return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  }
  if (!localSandboxRecoveryTestingEnabled(req)) {
    return res.status(503).json({
      error: 'Testing disruptions requires Duffel sandbox booking.',
      code: 'SANDBOX_REQUIRED',
    });
  }
  try {
    const memberTripId = req.body?.memberTripId;
    if (typeof memberTripId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(memberTripId)) {
      throw new HttpError(400, 'INVALID_TRIP', 'Provide a valid saved member trip ID.');
    }
    const result = await memberRecoveryMonitor.createLocalTestDisruption({ memberTripId });
    const pending = ['DISRUPTION_DETECTED', 'IN_PROGRESS', 'REVIEW_REQUIRED', 'PENDING', 'BOOKING'];
    res.status(pending.includes(result.state) ? 202 : 200).json({ recovery: result });
  } catch (err) {
    if (err.code === 'LOCAL_TEST_DISABLED') {
      return res.status(503).json({ error: err.message, code: err.code });
    }
    if (err.code === 'TRIP_NOT_FOUND') {
      return res.status(404).json({ error: err.message, code: err.code });
    }
    next(err);
  }
});

router.post('/member-bookings/approve', async (req, res, next) => {
  if (!isLocalBackendTestingRequest(req)) {
    return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  }
  try {
    const { airline, flightNumber } = validateFlightValues(
      typeof req.body?.airline === 'string' ? req.body.airline.trim().toUpperCase() : '',
      typeof req.body?.flightNumber === 'string' ? req.body.flightNumber.trim().toUpperCase() : '',
    );
    const { memberTripId, fingerprint } = req.body ?? {};
    if (typeof memberTripId !== 'string' || !/^[a-f0-9-]{16,64}$/i.test(memberTripId)
        || typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)) {
      throw new HttpError(400, 'INVALID_APPROVAL', 'Provide a saved trip ID and exact approval fingerprint.');
    }
    const recovery = await approveLocalMemberRecovery({
      memberTripId, airline, flightNumber, fingerprint,
    });
    if (recovery.status === 'STALE_APPROVAL') {
      return res.status(409).json({ recovery });
    }
    res.json({ recovery });
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
    const affected = [];
    for (const record of records) {
      const flight = record.quote.flight;
      const disruption = { type, minutes: type === 'DELAYED' ? minutes : null };
      const attempt = await recoveryAttempts.createSimulationAttempt({
        memberTripId: record.id, userId: record.userId, originalOrderId: record.orderId, flight, disruption,
      });
      const simulatorTripId = `member-recovery-${attempt.id}`;
      const nodeId = `member-flight-${record.id}`;
      const trip = provider.seedTrip(simulatorTripId, [{
        id: nodeId, type: 'FLIGHT', status: 'CONFIRMED', bookingId: record.orderId,
        origin: flight.origin, destination: flight.destination, airline: flight.airline,
        flightNumber: flight.flightNumber, cabin: flight.cabin, price: record.total ?? record.quote.total,
        refundable: flight.refundable,
        departureOffsetHours: flight.segments?.[0]?.departureOffsetHours,
        arrivalOffsetHours: flight.segments?.at(-1)?.arrivalOffsetHours,
        stops: flight.stops, durationMinutes: flight.durationMinutes,
        segments: structuredClone(flight.segments ?? []),
        scheduledDeparture: flight.departureTime, scheduledArrival: flight.arrivalTime, dependsOn: [],
      }]);
      const node = type === 'CANCELLED'
        ? provider.cancelNode(simulatorTripId, nodeId)
        : provider.delayFlight(simulatorTripId, nodeId, minutes);
      affected.push({
        memberTripId: record.id, simulatorTripId, nodeId,
        recoveryKey: attempt.recoveryKey,
        passengerName: record.passenger ? `${record.passenger.given_name} ${record.passenger.family_name}` : null,
        orderId: record.orderId, disruption: { type, minutes: type === 'DELAYED' ? minutes : null },
        node, trip,
      });
    }

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
      const storedAttempt = await recoveryAttempts.getLatestForTrip({ memberTripId, airline, flightNumber });
      if (!storedAttempt) {
        results.push({ memberTripId, status: 'SKIPPED', detail: 'confirmed matching member trip not found' });
        continue;
      }
      const record = await memberTrips.getById(storedAttempt.userId, memberTripId);
      if (!record) {
        results.push({ memberTripId, status: 'SKIPPED', detail: 'saved member trip not found' });
        continue;
      }
      if (storedAttempt.state === 'COMPLETED' || storedAttempt.state === 'COMPLETED_NEEDS_ATTENTION'
          || storedAttempt.state === 'NO_SAFE_OPTION' || storedAttempt.state === 'AWAITING_APPROVAL'
          || storedAttempt.state === 'MEMBER_TRIP_CONFLICT' || storedAttempt.state === 'REJECTED') {
        results.push({
          memberTripId,
          status: storedAttempt.state,
          updatedBooking: {
            orderId: record.orderId,
            bookingReference: record.bookingReference ?? null,
            flight: record.quote?.flight ?? null,
            total: record.total ?? record.quote?.total ?? null,
          },
          detail: 'This durable recovery attempt is already at a terminal state.',
        });
        continue;
      }
      const owner = randomUUID();
      const claimed = await recoveryAttempts.claim(storedAttempt.recoveryKey, owner);
      if (!claimed) {
        results.push({
          memberTripId, status: 'IN_PROGRESS',
          detail: 'Another worker owns this recovery attempt, or the attempt is already terminal.',
        });
        continue;
      }
      let attempt = claimed;
      const claimedState = claimed.state;
      const resumeOnly = ['BOOKING_REQUESTED', 'ORDER_CREATED', 'NEW_CONFIRMED',
        'OLD_RELEASE_PENDING', 'OLD_RELEASED', 'COMPLETED_NEEDS_ATTENTION',
        'MEMBER_TRIP_UPDATE_PENDING', 'MEMBER_TRIP_UPDATED', 'REVIEW_REQUIRED'].includes(claimedState);
      let leaseLost = false;
      const heartbeat = setInterval(() => {
        recoveryAttempts.renewClaim(attempt.recoveryKey, owner).then(renewed => {
          if (!renewed) leaseLost = true;
        }).catch(() => { leaseLost = true; });
      }, 20_000);
      heartbeat.unref?.();
      let confirmedReplacement = null;
      try {
        const checkpoint = async (state, fields = {}, event = {}) => {
          if (leaseLost) throw new Error('Recovery lease was lost; no further side effect is permitted.');
          attempt = await recoveryAttempts.checkpoint(attempt.recoveryKey, owner, state, fields, event);
          if (!attempt) throw new Error('Recovery claim was lost; no further side effect is permitted.');
          return attempt;
        };
        const replacementAlreadySaved = Boolean(attempt.newOrderId && record.orderId === attempt.newOrderId);
        if (replacementAlreadySaved) {
          await checkpoint('MEMBER_TRIP_UPDATED', { newOrderId: record.orderId }, {
            action: 'MEMBER_TRIP_UPDATE_RECONCILED', bookingId: record.orderId,
          });
          await checkpoint('COMPLETED', {}, { action: 'RECOVERY_COMPLETED' });
          results.push({
            memberTripId, status: 'COMPLETED',
            updatedBooking: {
              orderId: record.orderId, bookingReference: record.bookingReference ?? null,
              flight: record.quote?.flight ?? null, total: record.total ?? record.quote?.total ?? null,
            },
            detail: 'Saved trip already contains the confirmed replacement; durable completion reconciled.',
          });
          continue;
        }
        if (record.status !== 'CONFIRMED' || record.orderId !== attempt.originalOrderId) {
          await checkpoint('MEMBER_TRIP_CONFLICT', {}, {
            action: 'MEMBER_TRIP_CONFLICT',
            detail: 'saved booking no longer matches the recovery original',
          });
          results.push({
            memberTripId, status: 'MEMBER_TRIP_CONFLICT',
            detail: 'The saved booking changed since this disruption was recorded. No purchase was attempted.',
          });
          continue;
        }
        const simulatorTripId = `member-recovery-${attempt.id}`;
        const original = attempt.original;
        const nodeId = `member-flight-${record.id}`;
        const trip = provider.seedTrip(simulatorTripId, [{
          id: nodeId, type: 'FLIGHT', status: 'CONFIRMED', bookingId: attempt.originalOrderId,
          origin: original.origin, destination: original.destination, airline: original.airline,
          flightNumber: original.flightNumber, cabin: original.cabin,
          price: original.price ?? record.total ?? record.quote.total,
          refundable: original.refundable,
          departureOffsetHours: original.segments?.[0]?.departureOffsetHours,
          arrivalOffsetHours: original.segments?.at(-1)?.arrivalOffsetHours,
          stops: original.stops, durationMinutes: original.durationMinutes,
          segments: structuredClone(original.segments ?? []),
          scheduledDeparture: original.departureTime, scheduledArrival: original.arrivalTime,
          dependsOn: [],
        }]);
        if (attempt.disruption.type === 'CANCELLED') provider.cancelNode(simulatorTripId, nodeId);
        else provider.delayFlight(simulatorTripId, nodeId, attempt.disruption.minutes);

        if (attempt.state === 'DISRUPTION_SIMULATED') {
          await checkpoint('CLAIMED', { originalSnapshot: {
            memberTripId, originalOrderId: attempt.originalOrderId,
            memberTripRevision: record.updatedAt,
            policy: { ...DEFAULT_POLICY, costCap: config.policy.costCap },
            policyVersion: POLICY_VERSION,
          } }, { action: 'RECOVERY_CLAIMED' });
        }
        await checkpoint(resumeOnly ? 'RECONCILING' : 'ASSESSING', {}, {
          action: resumeOnly ? 'READ_ONLY_RECONCILIATION' : 'ASSESSING',
        });
        const policy = { ...DEFAULT_POLICY, costCap: config.policy.costCap };
        const recovery = await runRecovery({
          tripId: simulatorTripId,
          provider,
          policy,
          maxAttempts: 6,
          bookingPassenger: record.passenger,
          bookingMetadata: { tripshield_booking_id: record.id },
          durableRecovery: {
            resumeOnly,
            record: attempt,
            checkpoint,
          },
          searchReplacements: async ({ origin, destination, departureDate }) => {
            const { results: options } = await flightSearch.searchFlights({
              origin, destination, departuredate: departureDate,
            });
            return options;
          },
        });
        const persistence = await audit.recordEntries(
          recovery.audit.map(entry => ({ ...entry, tripId: memberTripId })),
          { tripId: memberTripId },
        );
        const recoveryRow = recovery.recoveries[0];
        const execution = recoveryRow?.execution;
        let savedTrip = null;
        if (execution?.bookingId && execution.status?.startsWith('RECOVERED')) {
          const flight = execution.option;
          confirmedReplacement = {
            orderId: execution.bookingId,
            bookingReference: execution.bookingReference ?? null,
            flight,
            total: execution.total,
          };
          await checkpoint('MEMBER_TRIP_UPDATE_PENDING', {
            newOrderId: execution.bookingId,
          }, { action: 'MEMBER_TRIP_UPDATE_PENDING', bookingId: execution.bookingId });
          savedTrip = await memberTrips.replaceConfirmedOrder(
            record.userId, record.id, record.orderId, record.updatedAt, {
            status: 'CONFIRMED',
            orderId: execution.bookingId,
            bookingReference: execution.bookingReference,
            quote: { ...record.quote, offerId: flight.offerId ?? flight.id, flight, expiresAt: null },
            total: execution.total,
            message: recoveryRow.message?.body ?? null,
            });
          if (!savedTrip) {
            results.push({
              memberTripId,
              passengerName: record.passenger
                ? `${record.passenger.given_name} ${record.passenger.family_name}` : null,
              status: 'MEMBER_TRIP_CONFLICT',
              detail: 'The replacement was confirmed, but the saved trip changed concurrently. Inspect both orders before retrying.',
              oldOrderId: record.orderId,
              updatedBooking: confirmedReplacement,
              recoveryId: persistence.recoveryId,
              auditPersisted: persistence.persisted,
              result: recovery,
            });
            continue;
          }
          await checkpoint('MEMBER_TRIP_UPDATED', { newOrderId: execution.bookingId }, {
            action: 'MEMBER_TRIP_UPDATED', bookingId: execution.bookingId,
          });
          if (execution.status === 'RECOVERED') {
            await checkpoint('COMPLETED', {}, { action: 'RECOVERY_COMPLETED' });
          } else {
            await checkpoint('COMPLETED_NEEDS_ATTENTION', {}, { action: 'RECOVERY_NEEDS_ATTENTION' });
          }
        } else if (execution?.status === 'REVIEW_REQUIRED') {
          await checkpoint('REVIEW_REQUIRED', {
            newOrderId: execution.pendingBookingId ?? attempt.newOrderId ?? null,
          }, { action: 'REVIEW_REQUIRED', detail: execution.detail ?? null });
        } else if (execution?.status === 'NOTHING_AUTHORISED' && recoveryRow?.approvalCandidate) {
          const approvalRequest = await prepareMemberApprovalRequest({
            candidate: recoveryRow.approvalCandidate,
            original,
            policy,
            passenger: record.passenger,
            recoveryProvider: provider,
          });
          if (approvalRequest) {
            await checkpoint('AWAITING_APPROVAL', { approvalRequest }, {
              action: 'MEMBER_APPROVAL_REQUIRED',
              optionId: approvalRequest.option.id,
              fingerprint: approvalRequest.binding.fingerprint,
              expiresAt: approvalRequest.expiresAt,
            });
          } else {
            await checkpoint('NO_SAFE_OPTION', {}, { action: 'NO_SAFE_OPTION' });
          }
        } else {
          await checkpoint('NO_SAFE_OPTION', {}, { action: 'NO_SAFE_OPTION' });
        }
        results.push({
          memberTripId, passengerName: record.passenger
            ? `${record.passenger.given_name} ${record.passenger.family_name}` : null,
          status: execution?.status ?? 'NO_RESULT',
          oldOrderId: record.orderId,
          updatedBooking: savedTrip ? {
            orderId: savedTrip.orderId,
            bookingReference: savedTrip.bookingReference ?? null,
            flight: savedTrip.quote?.flight ?? null,
            total: savedTrip.total ?? savedTrip.quote?.total ?? null,
          } : null,
          recoveryId: persistence.recoveryId,
          auditPersisted: persistence.persisted,
          approval: await getMemberRecoveryStatus({ userId: record.userId, memberTripId }),
          result: recovery,
        });
      } catch (error) {
        console.error(`[member-recover] passenger trip ${memberTripId} failed: ${error.name}`);
        try {
          if (['BOOKING_REQUESTED', 'ORDER_CREATED', 'NEW_CONFIRMED', 'OLD_RELEASE_PENDING',
            'OLD_RELEASED', 'MEMBER_TRIP_UPDATE_PENDING'].includes(attempt.state)) {
            await recoveryAttempts.checkpoint(attempt.recoveryKey, owner, 'REVIEW_REQUIRED', {}, {
              action: 'RECOVERY_INTERRUPTED', detail: 'side-effect outcome requires read-only reconciliation',
            });
          }
        } catch (checkpointError) {
          console.error(`[member-recover] checkpoint failed for ${memberTripId}: ${checkpointError.name}`);
        }
        results.push({
          memberTripId,
          status: 'REVIEW_REQUIRED',
          detail: 'Processing failed. Inspect the recovery audit and Duffel orders before retrying.',
          updatedBooking: confirmedReplacement,
        });
      } finally {
        clearInterval(heartbeat);
        await recoveryAttempts.releaseClaim(attempt.recoveryKey, owner);
      }
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
