import { Router } from 'express';
import { provider } from '../providers/index.js';
import { normalizeFlightStatus } from '../normalize/flightStatus.js';
import { config } from '../config.js';

const router = Router();

router.get('/:flightNumber', async (req, res, next) => {
  if (config.providers.status !== 'sabre') {
    return res.status(501).json({ code: 'SAVED_TRIP_REQUIRED', error: 'Choose a saved flight to track its Duffel booking. General flight-number tracking is unavailable.' });
  }
  try {
    const { flightNumber } = req.params;
    const raw = await provider.getFlightStatus({ flightNumber });
    const normalized = raw && normalizeFlightStatus(raw, flightNumber);
    if (!normalized) return res.status(503).json({ code: 'TRACKING_UNAVAILABLE', error: 'Live flight status is unavailable from the configured provider.' });
    res.json(normalized);
  } catch (err) {
    next(err);
  }
});

export default router;
