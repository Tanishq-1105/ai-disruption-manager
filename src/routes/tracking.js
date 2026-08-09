import { Router } from 'express';
import { provider } from '../providers/index.js';
import { normalizeFlightStatus } from '../normalize/flightStatus.js';
import { mockFlightStatus } from '../mock/flightStatus.js';

const router = Router();

router.get('/:flightNumber', async (req, res, next) => {
  try {
    const { flightNumber } = req.params;
    const raw = await provider.getFlightStatus({ flightNumber });
    const normalized = raw && normalizeFlightStatus(raw, flightNumber);
    res.json(normalized || mockFlightStatus(flightNumber));
  } catch (err) {
    next(err);
  }
});

export default router;
