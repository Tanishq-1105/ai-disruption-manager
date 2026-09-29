import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { provider } from '../providers/index.js';
import * as store from '../store/memberTrips.js';
import { createBookingService } from '../bookings/service.js';
import { BookingError } from '../bookings/errors.js';

export function createBookingRouter(service = createBookingService({ provider, store })) {
  const router = Router();
  router.use(['/bookings', '/trips'], requireAuth);
  const handle = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (error) {
      if (error instanceof BookingError) return res.status(error.status).json({ error: error.message, code: error.code, ...error.extra });
      // Never expose provider payloads, credentials, or passenger details.
      res.status(503).json({ error: 'Booking service is unavailable. Check your trips before trying again.', code: 'SERVICE_UNAVAILABLE' });
    }
  };

  router.post('/bookings/quote', handle(async (req, res) => {
    res.json({ quote: await service.quote({ userId: req.user.id, offerId: req.body.offerId }) });
  }));
  router.post('/bookings', handle(async (req, res) => {
    const trip = await service.book({ userId: req.user.id, quoteId: req.body.quoteId,
      version: req.body.version, passenger: req.body.passenger, idempotencyKey: req.get('Idempotency-Key') });
    res.status(['BOOKING', 'PENDING', 'REVIEW_REQUIRED'].includes(trip.status) ? 202 : 200).json({ trip });
  }));
  router.get('/trips', handle(async (req, res) => res.json({ results: await service.list(req.user.id) })));
  router.get('/trips/:id', handle(async (req, res) => res.json({ trip: await service.get(req.user.id, req.params.id) })));
  router.get('/trips/:id/tracking', handle(async (req, res) => res.json(await service.track(req.user.id, req.params.id))));
  router.post('/trips/:id/simulate-disruption', handle(async (req, res) => {
    res.json(await service.simulateDisruption({
      userId: req.user.id,
      id: req.params.id,
      type: req.body?.type,
      minutes: Number(req.body?.minutes),
    }));
  }));
  return router;
}

export default createBookingRouter();
