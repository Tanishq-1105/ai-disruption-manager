# Autonomous Travel-Disruption Concierge

See [AGENTS.md](./AGENTS.md) for the current implementation and
[SESSION_STATUS.md](./SESSION_STATUS.md) for verified status and next tasks.
The backend includes detection, impact analysis, option ranking, policy, sandbox
recovery, and audit storage, plus member auth/search, sandbox checkout, saved
trips, Duffel booking tracking, and search history. See
[mobile/README.md](./mobile/README.md) for the app and [CLAUDE.md](./CLAUDE.md)
for the original product vision.

## Setup

```
npm install
cp .env.example .env   # only if missing; fill in Duffel test token, Mongo URI and JWT secret
npm run dev
```

Requires a reachable MongoDB (`MONGO_URI`/`MONGO_DB_NAME` in `.env`), either a
local `mongod` or a hosted cluster. Member trips, checkout requests, accounts,
search history, and audit records use MongoDB. Demo simulator trips stay in memory.

### Ubuntu setup and startup

Node.js 24 is installed on the current Ubuntu workstation. Install the locked
dependencies from the repository root:

```bash
npm ci
npm --prefix mobile ci
```

Preserve existing `.env` and `mobile/.env` files when moving from Windows. If
either is missing, copy its corresponding `.env.example` and fill it in locally.
The backend needs `MONGO_URI`, `JWT_SECRET`, and a Duffel test token for the
default flight provider. Set `GOOGLE_MAPS_API_KEY` to enable airport-only flight
autocomplete; restrict the key to Places API (New) and keep it in the backend
`.env`, never `mobile/.env`. A working hosted MongoDB connection needs no local
MongoDB installation.

Start the backend in one terminal:

```bash
cd ~/Projects/ai-disruption-manager
npm run dev
```

Start the mobile app in another:

```bash
cd ~/Projects/ai-disruption-manager
npm run mobile
```

Open `http://localhost:4001` for the simulator. On a phone on the same Wi-Fi,
open the QR code in an Expo Go version compatible with SDK 57. Use `hostname -I`
to find the workstation's LAN IP; set `EXPO_PUBLIC_API_BASE_URL` in `mobile/.env`
to `http://<LAN-IP>:4001` and, if present, update `EXPO_PACKAGER_HOSTNAME` to that
same IP. Restart Expo after changing these settings. Use your configured port
if `PORT` differs from 4001. Stop either development server with Ctrl+C.

Open http://localhost:4001 (or whatever `PORT` is set to) for the simulator
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
  attempt with Duffel or the simulator. Cached booking retries do not consume it.
- The right-hand panel polls `/simulator/trips/:id/analyse` every 2s and
  shows what the Watcher detected and what the Impact Analyser says breaks
  downstream.
- **Run recovery** searches, ranks, applies policy, and attempts a replacement.
  A definitively rejected attempt keeps the original while trying a fallback.
  A pending/uncertain order pauses further purchases; run recovery again to check
  that existing attempt. Do not restart or reseed to clear an unresolved order.
  A confirmed replacement updates the trip's booking id and the flight card's
  status/schedule; repeating recovery of that repaired flight does not buy
  another ticket.

Recovery refreshes the offer before policy approval, independently checks the
created order's status/fare/itinerary before releasing the original, and adjusts
hotel/ride bookings only after the flight is recovered. The audit records that
sequence. Failed dependent changes remain visible as open items.

Demo trip state, pending recovery attempts and serialization remain in memory.
Member checkout uses its own durable Mongo claims; saved member trips and saved
policy are not yet connected to recovery. See SESSION_STATUS.md for next work.

## Member sandbox booking and tracking

Use `SEARCH_PROVIDER=duffel`, `BOOKING_PROVIDER=duffel`,
`STATUS_PROVIDER=duffel`, and a `DUFFEL_ACCESS_TOKEN` beginning with
`duffel_test_`. The member flow always refuses live tokens.

1. Start backend and Expo in separate terminals using the Ubuntu commands above.
   Expo prints the phone QR code. Reload the app after navigation changes.
2. Search a future one-way flight under Home → Flights, choose a result, and
   open booking. Sign in or create an account when prompted.
3. Review the refreshed fare and use **Use test passenger**, or fill in one
   adult's test details. Confirm the sandbox booking. A changed fare requires
   another explicit confirmation; expired offers require another search.
4. The confirmation uses Duffel's booking reference and saves the flight to
   **Protected Trips** automatically. Trips persist after app/backend restarts.
   A pending outcome offers **Check status** and never automatically buys again.
5. Open Trips → trip details → **Track this trip**, or select a saved flight in
   Track. **Refresh from Duffel** reads order status and airline-reported schedule
   changes. It does not accept a change or trigger recovery.

These are API-backed test reservations with no real charge or usable ticket.
Hotels/cabs remain search demos. Track does not provide arbitrary flight-number,
boarding, landed, or on-time status. There is no mock tracking fallback.
Autonomy preferences are still local; automatic monitoring is not connected.

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
- `POST /simulator/trips/:tripId/recover` — runs recovery and returns decisions,
  booking attempts, member message, and audit persistence status.
- `GET /simulator/trips/:tripId/audit`, `GET /simulator/audit` — durable audit reads.
- `GET /simulator/state` — current in-memory trips + bookings.

**Member app backend** (used by `mobile/`):

- `POST /auth/signup`, `POST /auth/login`, `GET /auth/me` (bearer token).
- `GET /search/airports?query=` — Google Places API (New) airport-only
  predictions. `POST /search/airports/resolve` with `{ placeId }` returns an
  IATA code only when Duffel confirms a unique nearby airport.
- `GET /search/flights?origin&destination&departuredate` — normalized Duffel test
  offers only; the mobile flight-search route rejects non-Duffel provider
  configuration. `GET /search/hotels?destination&checkIn&checkOut`
  and `GET /search/cabs?destination` — mock data (Sabre has no cab product;
  hotels aren't provisioned on this trial account). All three auto-log to
  history when a valid bearer token is sent, but none require one.
- `POST /bookings/quote` — authenticated `{ offerId }`; returns a refreshed,
  versioned server quote.
- `POST /bookings` — authenticated `{ quoteId, version, passenger }` with header
  `Idempotency-Key: <quoteId>`; returns a confirmed or pending saved booking.
- `GET /trips`, `GET /trips/:id` — authenticated, current user's trips only.
  An individual read also reconciles pending order outcomes.
- `GET /trips/:id/tracking` — authenticated Duffel order and schedule-change reads
  for the current user's saved trip.
- `GET /tracking/:flightNumber` — legacy route; default 501 `SAVED_TRIP_REQUIRED`.
  Explicit Sabre mode attempts status but returns 503 when unavailable.
- `GET /history` — a signed-in user's past searches, newest first (bearer
  token required).

## Tests

```
npm test
```

To check recovery against the live Duffel sandbox without starting a dev server:

```bash
npm run smoke:recovery
```

It searches test flights, recovers its own simulator trip, verifies independent
confirmation/old-ticket release/dependent ordering and Mongo audit persistence,
then cancels the test order and removes its temporary audit. An unresolved
outcome retains audit references for review. It requires Duffel test credentials,
`SEARCH_PROVIDER=duffel`, and reachable MongoDB.

Automated tests also require MongoDB and use the isolated
`travel_disruption_concierge_test` database configured through `.env.test`;
never point destructive store tests at member data. The suite stubs travel APIs.

For a live member API smoke check, start a temporary backend in one terminal:

```bash
PORT=4002 npm start
```

In another terminal at the repository root:

```bash
npm run smoke:member
```

This requires the configured test token and MongoDB. It creates its own account,
searches JFK–LAX, creates and independently checks a test order, verifies saved
trips/retries/ownership/tracking, then cancels the order and deletes only its own
member records. An unresolved booking or failed cancellation keeps those records
for review. `SMOKE_BASE_URL` can override the default `http://127.0.0.1:4002`.
Stop the temporary backend with Ctrl+C afterward. Results belong in
[SESSION_STATUS.md](./SESSION_STATUS.md).

## Structure

```
src/
  config.js                 provider, JWT and Mongo configuration
  bookings/service.js       member quote, checkout and reconciliation
  duffel/                   REST client, recovery adapter, member sandbox adapter
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
    mongo.js, users.js, history.js, audit.js, memberTrips.js   durable member data
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
    index.js                    provider port: Duffel/Sabre search, Duffel booking/tracking, simulator
  routes/
    health.js, auth.js, search.js, bookings.js, tracking.js, history.js, simulator.js
  server.js                   Express app entry + static control-panel frontend
public/
  index.html, styles.css, app.js   control panel UI (vanilla, no build step)
mobile/
  the member-facing Expo/React Native app — see mobile/README.md
test/
  one file per module above, node:test (built-in, no Jest)
```
