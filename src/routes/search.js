import { Router } from 'express';
import { provider } from '../providers/index.js';

// Smoke-tests Sabre connectivity — the "looking" half. Booking/action routes
// come later, behind the same provider port, once the simulator's actions
// (Phase 6) are wired in.
const router = Router();

router.post('/flights', async (req, res, next) => {
  try {
    res.json(await provider.searchFlights(req.body));
  } catch (err) {
    next(err);
  }
});

router.post('/hotels', async (req, res, next) => {
  try {
    res.json(await provider.searchHotels(req.body));
  } catch (err) {
    next(err);
  }
});

export default router;
