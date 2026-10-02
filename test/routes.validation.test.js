import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import search from '../src/routes/search.js';
import simulatorRouter from '../src/routes/simulator.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import * as simulator from '../src/simulator/state.js';
import { config } from '../src/config.js';

test('invalid search inputs return 400 and missing simulator resources return 404', async () => {
  const app = express();
  app.use(express.json());
  app.use('/search', search);
  app.use('/simulator', simulatorRouter);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  simulator.seedTrip('http-test', [{ id: 'hotel', type: 'HOTEL' },
    { id: 'flight', type: 'FLIGHT', scheduledArrival: '2030-01-01T12:00:00Z' }]);
  const call = (path, body) => fetch(`${base}${path}`, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  try {
    for (const query of ['', '?origin=JFK', '?origin=JFK&destination=LAX',
      '?origin=JFK&destination=LAX&departuredate=2030-02-30',
      '?origin=JFK&destination=JFK&departuredate=2030-10-12',
      '?origin=JFK&origin=LHR&destination=LAX&departuredate=2030-10-12',
      '?origin[x]=JFK&destination=LAX&departuredate=2030-10-12']) {
      const response = await call(`/search/flights${query}`);
      assert.equal(response.status, 400, query);
      assert.equal((await response.json()).code, 'INVALID_SEARCH');
    }
    for (const path of ['/search/hotels', '/search/cabs', '/search/airports', '/search/airports?query=m',
      '/search/hotels?destination=LON&checkIn=2030-10-12&checkOut=2030-10-11']) {
      assert.equal((await call(path)).status, 400);
    }
    assert.equal((await call('/search/airports/resolve', {})).status, 400);
    for (const [path, body] of [
      ['/simulator/trips/absent/analyse'], ['/simulator/trips/absent/recover', {}],
      ['/simulator/trips/absent/nodes/flight/cancel', {}],
      ['/simulator/trips/http-test/nodes/absent/cancel', {}],
      ['/simulator/trips/http-test/flights/absent/delay', { minutes: 10 }],
    ]) assert.equal((await call(path, body)).status, 404, path);
    for (const minutes of [-1, 'nonsense']) {
      assert.equal((await call('/simulator/trips/http-test/flights/flight/delay', { minutes })).status, 400);
    }
    assert.equal((await call('/simulator/trips/http-test/flights/hotel/delay', { minutes: 10 })).status, 400);
    assert.equal((await call('/simulator/trips/http-test/seed', { nodes: 'invalid' })).status, 400);
    assert.equal((await call('/search/cabs?destination=London')).status, 200);
    assert.equal((await call('/search/hotels?destination=LON&checkIn=2030-10-12&checkOut=2030-10-13')).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    simulator._resetForTests();
  }
});

test('mobile flight search refuses non-Duffel providers', async () => {
  const app = express();
  app.use('/search', search);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  const previousSearchProvider = config.providers.search;
  config.providers.search = 'sabre';
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/search/flights?origin=HYD&destination=BOM&departuredate=2030-10-12`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'DUFFEL_SEARCH_REQUIRED');
  } finally {
    config.providers.search = previousSearchProvider;
    await new Promise(resolve => server.close(resolve));
  }
});
