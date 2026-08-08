import { Router } from 'express';
import { provider } from '../providers/index.js';

// The judge-facing control panel: seed a trip, then hit cancel / delay / fail
// to trigger a disruption live during the demo.
const router = Router();

router.post('/trips/:tripId/seed', (req, res) => {
  const trip = provider.seedInventory(req.params.tripId, req.body.flights || []);
  res.status(201).json(trip);
});

router.post('/trips/:tripId/flights/:flightId/cancel', (req, res, next) => {
  try {
    res.json(provider.cancelFlight(req.params.tripId, req.params.flightId));
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

router.get('/state', (req, res) => {
  res.json(provider.getState());
});

export default router;
