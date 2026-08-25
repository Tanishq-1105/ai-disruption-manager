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

// The judge-facing control panel: seed a trip, then hit cancel / delay / fail
// to trigger a disruption live during the demo.
const router = Router();

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
