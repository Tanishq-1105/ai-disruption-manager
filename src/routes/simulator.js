import { Router } from 'express';
import { provider } from '../providers/index.js';
import { detectDisruptions } from '../agent/detection.js';
import { analyseImpact } from '../agent/impact.js';
import { DEMO_TRIP_ID, buildDemoTrip } from '../simulator/demoTrip.js';

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

router.get('/state', (req, res) => {
  res.json(provider.getState());
});

export default router;
