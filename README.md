# Autonomous Travel-Disruption Concierge

See [CLAUDE.md](./CLAUDE.md) for full project context. This covers Phase 0
(Sabre connectivity + backend skeleton) and Phase 1 (simulator + control
panel).

## Setup

```
npm install
cp .env.example .env   # fill in SABRE_CLIENT_ID / SABRE_CLIENT_SECRET
npm run dev
```

## Endpoints

- `GET /health` — liveness + whether Sabre credentials are configured.
- `POST /search/flights`, `POST /search/hotels` — pass-through to Sabre
  (real data; requires credentials in `.env`).
- `POST /simulator/trips/:tripId/seed` — seed a trip with `{ flights: [...] }`.
- `POST /simulator/trips/:tripId/flights/:flightId/cancel` — control-panel
  cancel button.
- `POST /simulator/trips/:tripId/flights/:flightId/delay` — control-panel
  delay button, body `{ minutes }`.
- `POST /simulator/bookings/fail-next` — arms a forced failure on the next
  booking attempt (control-panel fail button).
- `GET /simulator/state` — current in-memory trips + bookings.

## Tests

```
npm test
```

## Structure

```
src/
  config.js              env config
  sabre/
    auth.js              token cache + refresh (client credentials)
    client.js             BFM / hotel / status calls
  simulator/
    state.js              in-memory trips, bookings, disruption triggers
  providers/
    index.js               the provider port: search -> Sabre, actions -> simulator
  routes/
    health.js, search.js, simulator.js
  server.js               Express app entry
test/
  sabre.auth.test.js
  simulator.state.test.js
```
