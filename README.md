# Autonomous Travel-Disruption Concierge

See [CLAUDE.md](./CLAUDE.md) for full project context. Covers Phase 0 (Sabre
connectivity + backend skeleton), Phase 1 (simulator + control panel),
Phase 2 (Watcher / detection), and Phase 3 (Impact Analyser), plus the
member-facing app's backend (auth, search, tracking, history — see
[mobile/README.md](./mobile/README.md) for the app itself).

## Setup

```
npm install
cp .env.example .env   # fill in SABRE_CLIENT_ID / SABRE_CLIENT_SECRET / JWT_SECRET
npm run dev
```

Requires a local `mongod` running (`MONGO_URI`/`MONGO_DB_NAME` in `.env`) —
used for user accounts and search history, not for trip/simulator data
(that stays in-memory; see CLAUDE.md's guardrail on not adding persistence
you don't need yet).

Open http://localhost:4000 (or whatever `PORT` is set to) for the simulator
control panel, or hit the API directly.

To run the mobile app, use `npm run mobile` from here (equivalent to `cd
mobile && npx expo start`) — **do not** run `npx expo start` or `npm install
expo` from this root folder directly; `expo` is not (and should not be) a
dependency of this backend, only of `mobile/`. Running Expo commands from
the wrong directory has caused real breakage before (installs `expo` into
the backend's `node_modules`, or picks up the wrong SDK version).

## Control panel

Click **Seed demo trip** to load a fixture trip: an outbound leg, a
connecting leg, a hotel, ground transport, and a client meeting, wired up
with `dependsOn` so a disruption ripples downstream. Then:

- **Cancel** / **Delay 90m** on a flight card to trigger a disruption.
- **Force next booking failure** arms a forced failure for the next booking
  attempt (used once Phase 6 wires up real booking).
- The right-hand panel polls `/simulator/trips/:id/analyse` every 2s and
  shows what the Watcher detected and what the Impact Analyser says breaks
  downstream.

## Endpoints

**Simulator / agent core** (used by the control panel):
- `GET /health` — liveness + whether Sabre credentials are configured.
- `POST /simulator/demo/seed` — seed the fixture trip used by the control panel.
- `POST /simulator/trips/:tripId/seed` — seed a custom trip with `{ nodes: [...] }`
  (each node: `{ id, type: FLIGHT|GROUND|HOTEL|COMMITMENT, dependsOn: [...], ... }`).
- `POST /simulator/trips/:tripId/nodes/:nodeId/cancel` — control-panel cancel button.
- `POST /simulator/trips/:tripId/flights/:flightId/delay` — control-panel
  delay button, body `{ minutes }`.
- `POST /simulator/bookings/fail-next` — arms a forced failure on the next
  booking attempt (control-panel fail button).
- `GET /simulator/trips/:tripId/analyse` — runs the Watcher then the Impact
  Analyser against the trip's current state.
- `GET /simulator/state` — current in-memory trips + bookings.

**Member app backend** (used by `mobile/`):
- `POST /auth/signup`, `POST /auth/login`, `GET /auth/me` (bearer token).
- `GET /search/flights?origin&destination&departuredate` — real Sabre
  (InstaFlights), normalized. `GET /search/hotels?destination&checkIn&checkOut`
  and `GET /search/cabs?destination` — mock data (Sabre has no cab product;
  hotels aren't provisioned on this trial account). All three auto-log to
  history when a valid bearer token is sent, but none require one.
- `GET /tracking/:flightNumber` — real Sabre flight-status attempt, falls
  back to deterministic mock data (this product isn't provisioned on this
  trial account either).
- `GET /history` — a signed-in user's past searches, newest first (bearer
  token required).

## Tests

```
npm test
```

Requires the same local `mongod` (tests use a separate
`travel_disruption_concierge_test` database, configured via `.env.test`).

## Structure

```
src/
  config.js                 env config (Sabre, JWT, Mongo)
  sabre/
    auth.js                  token cache + refresh (client credentials, double base64)
    client.js                 InstaFlights search + hotel/status calls
  simulator/
    state.js                  in-memory trips (node graph), bookings, disruption triggers
    demoTrip.js                fixture trip used by the control panel
  agent/
    detection.js               Watcher (Phase 2) — pure: cancellation + connection-feasibility
    impact.js                   Impact Analyser (Phase 3) — pure: walks dependsOn, classifies impact
  store/
    mongo.js, users.js, history.js   accounts + search history (Mongo — needs to survive restarts)
  auth/
    passwords.js, tokens.js     hashing + JWT sign/verify
  middleware/
    requireAuth.js, optionalAuth.js
  normalize/
    flights.js                  Sabre PricedItineraries -> flat shape
    flightStatus.js               best-effort, unverified (product not provisioned here)
  mock/
    hotels.js, cabs.js, flightStatus.js   fixture data where Sabre has no product/access
  providers/
    index.js                    the provider port: search -> Sabre or mock, actions -> simulator
  routes/
    health.js, auth.js, search.js, tracking.js, history.js, simulator.js
  server.js                   Express app entry + static control-panel frontend
public/
  index.html, styles.css, app.js   control panel UI (vanilla, no build step)
mobile/
  the member-facing Expo/React Native app — see mobile/README.md
test/
  one file per module above, node:test (built-in, no Jest)
```
