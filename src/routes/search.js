import { Router } from 'express';
import { provider } from '../providers/index.js';
import * as flightSearch from '../providers/search.js';
import { optionalAuth } from '../middleware/optionalAuth.js';
import * as history from '../store/history.js';

// Browse-only endpoints — no booking/checkout flow. Flights are real Sabre
// data (InstaFlights); hotels/cabs are mock (see providers/index.js for why).
// optionalAuth so browsing never requires login — a signed-in user just gets
// their search auto-logged to history.
const router = Router();
router.use(optionalAuth);

async function logHistory(req, category, results) {
  if (!req.user) return;
  await history.addEntry({
    userId: req.user.id,
    category,
    query: req.query,
    resultCount: results.length,
  });
}

router.get('/flights', async (req, res, next) => {
  try {
    const { origin, destination, departuredate } = req.query;
    // One entry point for both providers: already normalized, already filtered
    // of itineraries that could not physically be flown.
    const { source, results, rejected } = await flightSearch.searchFlights({
      origin, destination, departuredate,
    });
    if (rejected.length > 0) {
      console.warn(
        `[search/flights] dropped ${rejected.length} implausible itinerary(ies) for ` +
        `${origin}-${destination} ${departuredate}: ${rejected[0].issues[0]}`,
      );
    }
    await logHistory(req, 'flights', results);
    res.json({ source, query: req.query, results, filtered: rejected.length });
  } catch (err) {
    next(err);
  }
});

router.get('/hotels', async (req, res, next) => {
  try {
    const { destination, checkIn, checkOut } = req.query;
    const results = await provider.searchHotels({ destination, checkIn, checkOut });
    await logHistory(req, 'hotels', results);
    res.json({ source: 'mock', query: req.query, results });
  } catch (err) {
    next(err);
  }
});

router.get('/cabs', async (req, res, next) => {
  try {
    const { destination } = req.query;
    const results = await provider.searchCabs({ destination });
    await logHistory(req, 'cabs', results);
    res.json({ source: 'mock', query: req.query, results });
  } catch (err) {
    next(err);
  }
});

export default router;
