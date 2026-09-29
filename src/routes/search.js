import { Router } from 'express';
import { provider } from '../providers/index.js';
import * as flightSearch from '../providers/search.js';
import { optionalAuth } from '../middleware/optionalAuth.js';
import * as history from '../store/history.js';
import { HttpError } from '../errors.js';

// Browse-only endpoints. Flights use the selected provider; hotels/cabs are mock.
// optionalAuth so browsing never requires login — a signed-in user just gets
// their search auto-logged to history.
const router = Router();
router.use(optionalAuth);

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const invalid = message => { throw new HttpError(400, 'INVALID_SEARCH', message); };

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
    if (typeof origin !== 'string' || !/^[A-Z]{3}$/.test(origin)
        || typeof destination !== 'string' || !/^[A-Z]{3}$/.test(destination)
        || origin === destination || !validDate(departuredate)) {
      invalid('Provide distinct three-letter origin/destination airport codes and departuredate as YYYY-MM-DD.');
    }
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
    if (!nonempty(destination) || !validDate(checkIn) || !validDate(checkOut) || checkOut <= checkIn) {
      invalid('Provide destination and valid checkIn/checkOut dates, with checkOut after checkIn.');
    }
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
    if (!nonempty(destination)) invalid('Provide a pickup destination.');
    const results = await provider.searchCabs({ destination });
    await logHistory(req, 'cabs', results);
    res.json({ source: 'mock', query: req.query, results });
  } catch (err) {
    next(err);
  }
});

export default router;
