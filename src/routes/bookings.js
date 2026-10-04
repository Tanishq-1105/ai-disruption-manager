import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { provider } from '../providers/index.js';
import * as store from '../store/memberTrips.js';
import { createBookingService } from '../bookings/service.js';
import * as memberRecovery from '../bookings/memberRecovery.js';
import { BookingError } from '../bookings/errors.js';

export function createBookingRouter(
  service = createBookingService({ provider, store }),
  recoveryController = memberRecovery,
) {
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
  router.get('/trips/:id/recovery', handle(async (req, res) => {
    const recovery = await recoveryController.getMemberRecoveryStatus({ userId: req.user.id, memberTripId: req.params.id });
    if (!recovery) {
      await service.ensureOwned(req.user.id, req.params.id);
      return res.json({ recovery: null });
    }
    res.json({ recovery });
  }));
  router.post('/trips/:id/recovery/run', handle(async (req, res) => {
    const recovery = await recoveryController.recoverMemberTrip({ userId: req.user.id, memberTripId: req.params.id });
    if (recovery.status === 'NOT_FOUND') throw new BookingError(404, 'TRIP_NOT_FOUND', 'Trip or recovery not found.');
    res.json({ recovery });
  }));
  router.post('/trips/:id/recovery/approve', handle(async (req, res) => {
    if (typeof req.body?.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(req.body.fingerprint)) {
      throw new BookingError(400, 'INVALID_APPROVAL', 'Review the current recovery terms before approving.');
    }
    const recovery = await recoveryController.recoverMemberTrip({
      userId: req.user.id,
      memberTripId: req.params.id,
      approvalFingerprint: req.body.fingerprint,
    });
    if (recovery.status === 'NOT_FOUND') throw new BookingError(404, 'TRIP_NOT_FOUND', 'Trip or recovery not found.');
    if (recovery.status === 'STALE_APPROVAL') {
      throw new BookingError(409, 'STALE_APPROVAL', recovery.detail);
    }
    res.json({ recovery });
  }));
  router.post('/trips/:id/recovery/reject', handle(async (req, res) => {
    if (typeof req.body?.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(req.body.fingerprint)) {
      throw new BookingError(400, 'INVALID_APPROVAL', 'This recovery approval is no longer current.');
    }
    const rejected = await recoveryController.rejectMemberRecovery({
      userId: req.user.id,
      memberTripId: req.params.id,
      approvalFingerprint: req.body.fingerprint,
    });
    if (!rejected) throw new BookingError(409, 'STALE_APPROVAL', 'This recovery approval is no longer current.');
    res.json({ recovery: { state: rejected.state } });
  }));
  return router;
}

export default createBookingRouter();
