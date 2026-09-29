import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { activeSearchProvider, providerMismatch } from './providers/search.js';
import healthRouter from './routes/health.js';
import searchRouter from './routes/search.js';
import simulatorRouter from './routes/simulator.js';
import authRouter from './routes/auth.js';
import trackingRouter from './routes/tracking.js';
import historyRouter from './routes/history.js';
import bookingRouter from './routes/bookings.js';
import { errorHandler } from './middleware/errorHandler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const app = express();
app.use(express.json());

app.get('/api', (req, res) => {
  res.json({
    name: 'travel-disruption-concierge',
    endpoints: [
      'GET /health',
      'POST /auth/signup',
      'POST /auth/login',
      'GET /auth/me',
      'GET /search/flights',
      'GET /search/hotels',
      'GET /search/cabs',
      'GET /tracking/:flightNumber',
      'GET /history',
      'POST /bookings/quote',
      'POST /bookings',
      'GET /trips',
      'GET /trips/:id',
      'GET /trips/:id/tracking',
      'POST /trips/:id/simulate-disruption',
      'POST /simulator/demo/seed',
      'POST /simulator/trips/:tripId/seed',
      'POST /simulator/trips/:tripId/nodes/:nodeId/cancel',
      'POST /simulator/trips/:tripId/flights/:flightId/delay',
      'POST /simulator/bookings/fail-next',
      'GET /simulator/member-bookings?airline=ZZ&flightNumber=ZZ123',
      'POST /simulator/member-bookings/disrupt',
      'POST /simulator/member-bookings/recover',
      'GET /simulator/trips/:tripId/analyse',
      'GET /simulator/state',
    ],
  });
});

app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/search', searchRouter);
app.use('/tracking', trackingRouter);
app.use('/history', historyRouter);
app.use(bookingRouter);
app.use('/simulator', simulatorRouter);
app.use(express.static(publicDir));

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Travel-Disruption Concierge backend listening on :${config.port}`);
  console.log(
    `providers  search=${activeSearchProvider()} booking=${config.providers.booking} status=${config.providers.status}`,
  );
  // Fail loudly at startup rather than confusingly at the moment of booking.
  const mismatch = providerMismatch();
  if (mismatch) console.warn(`WARNING: ${mismatch}`);
});
