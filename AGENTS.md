# Autonomous Travel Disruption Manager - Project Context

> Read this file first in a new coding chat. It is the maintained, compact
> context for the repository. Inspect only the source files relevant to the
> requested change instead of rereading the whole project.

Last source review: 2026-08-19

## Source-of-truth order

1. The current source code and `package.json` files are authoritative.
2. This file summarizes the current implementation and intended constraints.
3. `README.md` contains operator-facing setup notes.
4. `CLAUDE.md` contains the original product vision and roadmap. Some of its
   stack choices describe the target architecture, not code that exists today.
5. For every change under `mobile/`, also follow `mobile/AGENTS.md`. The mobile
   app is deliberately pinned to Expo SDK 54.

Update this file when an API, architecture boundary, setup requirement, major
feature status, or non-negotiable invariant changes.

## Product in one paragraph

This is an American Express hackathon prototype called the **Autonomous
Travel-Disruption Concierge**, branded **TripShield** in the mobile UI. Its goal
is to detect a cancelled flight or impossible connection, determine which
downstream parts of the trip are affected, find a replacement, apply the
member's autonomy policy, rebook safely, adjust related bookings, and send one
clear notification. The one-line promise is: **the member wakes up already
rebooked**.

The system intentionally separates:

- **Information/search:** real Sabre data where the trial account supports it.
- **Actions/ticketing:** an in-memory simulator, because the sandbox cannot
  cancel or reissue real airline tickets.

Both belong behind `src/providers/index.js`. The agent core must not depend
directly on Sabre or simulator implementations.

## Current implementation status

### Implemented now

- Node.js/Express backend using ES modules.
- Vanilla HTML/CSS/JS judge-facing simulator panel served from `public/`.
- Expo/React Native member app in `mobile/`.
- Sabre client-credentials authentication with token caching and a 60-second
  refresh skew.
- Real flight search through Sabre InstaFlights
  (`GET /v1/shop/flights`), normalized for the mobile app.
- Mock hotel search, mock cab search, and deterministic mock flight status.
- MongoDB-backed member accounts and search history.
- JWT signup, login, session restore, required auth, and optional auth.
- In-memory trip graph and simulated booking state.
- Demo trip seeding, cancellation, delay, and one-shot booking-failure injection.
- Phase 2 Watcher: cancellation and connection-risk detection.
- Phase 3 Impact Analyser: downstream graph traversal and action classification.
- Phase 4 Option Engine: viability filtering and deterministic, explainable
  scoring of replacement flights.
- Phase 5 Policy Engine: bounded autonomy returning ACT, SPLIT or ESCALATE.
- Phase 6 Safe Executor: idempotent booking, confirm-before-release ordering,
  candidate fallback on failure, and an audit entry per action.
- End-to-end recovery loop wired to the control panel via
  `POST /simulator/trips/:tripId/recover`.
- Durable Mongo-backed audit trail (`audit` collection), written per recovery
  and readable after the request that created it.
- Notifier: composes the single member-facing message, returned in the recovery
  response and rendered in the control panel.
- Duffel adapter behind the provider port: real sandbox search, seat maps,
  order creation, independent confirmation and cancellation.
- **Duffel is the default provider for search and booking.** Sabre stays wired
  and one env var away (`SEARCH_PROVIDER=sabre`, `BOOKING_PROVIDER=simulator`).
- Physical-plausibility filtering of search results before they reach the app
  or the agent core.
- Mobile search/results/filter/sort/details flows, tracking, auth, and history.
- Mobile demo-only booking confirmation, empty Trips state, and locally stored
  autonomy/notification preferences.

### Not implemented yet

- A real booking/payment/ticketing API for production. Duffel's sandbox covers
  the booking path in test mode; no live ticketing adapter exists.
- Persisted trips or a member trip-graph API.
- LangGraph orchestration.
- PostgreSQL trip/audit storage and Redis search caching described by the
  original target architecture.
- SSE progress updates.
- WhatsApp/email/SMS delivery. The message is composed; no channel sends it.
- AWS deployment, production ticketing adapter, and hardening/circuit breakers.

The control panel's **Force next booking failure** button now works end to end:
arm it, then click **Run recovery**, and the agent's first booking attempt
fails, the old ticket is retained, and it falls through to the next ranked
candidate before releasing the old one. Verified live on 2026-08-25.

Re-seeding a trip deliberately clears that trip's bookings and idempotency keys.
Without it a second demo run reuses the first run's keys, `bookFlight`
short-circuits to the cached booking, and the armed failure never fires.

The mobile Booking screen still confirms a demo action only; it creates no
reservation, payment, ticket, or trip.

## Architecture at a glance

```text
Member Expo app --------------------+
                                     |
Judge control panel in public/ ------+--> Express routes
                                           |
                       +-------------------+-------------------+
                       |                                       |
                 provider port                         auth/history stores
             src/providers/index.js                         MongoDB
                       |
          +------------+-------------+
          |            |             |
     Sabre search   mock data    in-memory simulator
                                  |
                         detectDisruptions(trip)
                                  |
                         analyseImpact(trip, event)
```

Current search flow:

```text
mobile search -> /search/* -> optional JWT -> provider
  -> Sabre flight search or mock hotel/cab data
  -> normalize where needed -> log history if signed in -> response
```

Current simulator flow:

```text
seed demo -> cancel/delay a node -> panel polls /analyse every 2 seconds
  -> pure Watcher events -> pure downstream impact classifications
```

Target recovery flow, still to build:

```text
Notice -> Assess -> Pick -> Policy -> Book new -> Confirm new
  -> Release old -> Adjust safe dependents -> Notify and audit
```

## Non-negotiable design and safety rules

- Route external travel and action calls through the provider port.
- Keep all money, scoring, policy, and booking decisions deterministic and
  explainable. An LLM may not decide spending or booking behavior.
- **Confirm the new ticket before releasing the old ticket.** If a booking
  fails, retain the old ticket and try the next candidate.
- Every mutating booking request must carry a unique idempotency key.
- Every automatic action and its authorizing policy decision must eventually be
  written to the audit trail.
- Prefer pure functions for agent logic. Detection and impact analysis must stay
  free of network, database, and polling concerns.
- Use ISO 8601 strings for times.
- Do not add persistence for demo-only simulator data without a real need.
- Bounded autonomy: act alone only on small/reversible changes; escalate large
  or irreversible decisions. A safe flight change and risky hotel change may be
  split so only the hotel is escalated.

Default policy intent from the product vision:

- Act alone for same-cabin, same-day, refundable changes arriving within about
  12 hours and under the member's cost cap.
- Escalate cost-cap violations, overnight stays, cabin downgrades,
  non-refundable changes, and trip cancellation/refund.

## Repository map

```text
.
|-- AGENTS.md                     this maintained context
|-- CLAUDE.md                     original vision, invariants, and roadmap
|-- README.md                     setup, endpoint, and demo notes
|-- package.json                  backend scripts and dependencies
|-- .env.example                  backend environment template
|-- public/
|   |-- index.html                simulator control panel
|   |-- app.js                    API calls, rendering, 2-second polling
|   `-- styles.css
|-- src/
|   |-- server.js                 Express entry, routers, static files, errors
|   |-- config.js                 environment-derived configuration
|   |-- providers/index.js        single provider port
|   |-- agent/
|   |   |-- detection.js          pure Phase 2 Watcher
|   |   |-- impact.js             pure Phase 3 Impact Analyser
|   |   |-- options.js            pure Phase 4 Option Engine
|   |   |-- policy.js             pure Phase 5 Policy Engine
|   |   |-- executor.js           Phase 6 safe executor (provider injected)
|   |   |-- notifier.js           pure member-message composer
|   |   `-- recovery.js           orchestrates phases 2-6
|   |-- simulator/
|   |   |-- state.js              in-memory trips/bookings/idempotency/fail flag
|   |   `-- demoTrip.js           linked demo fixture
|   |-- duffel/
|   |   |-- client.js             raw Duffel REST calls + live-token guard
|   |   `-- adapter.js            provider-port shape, owns idempotency
|   |-- sabre/
|   |   |-- auth.js               double-base64 auth and token cache
|   |   |-- client.js             Sabre request wrapper and product calls
|   |   |-- probe.js              pure provisioning-verdict classifier
|   |   `-- probeCatalog.js       candidate endpoints + path variants
|   |-- normalize/
|   |   |-- flights.js            InstaFlights response -> mobile shape
|   |   |-- duffelFlights.js      Duffel offers -> the same shape
|   |   |-- plausibility.js       pure physical-plausibility filter
|   |   `-- flightStatus.js       best-effort, not live-account verified
|   |-- mock/                      hotel, cab, and flight-status fixtures
|   |-- auth/                      bcrypt helpers and JWT helpers
|   |-- middleware/                required and optional bearer auth
|   |-- store/                     Mongo connection, users, history, audit
|   `-- routes/                    health/auth/search/tracking/history/simulator
|-- scripts/
|   |-- probe-sabre.js           live provisioning probe (network, needs .env)
|   |-- probe-providers.js       feasibility probe for Duffel/AeroDataBox/OpenSky
|   |-- check-plausibility.js    shows what the plausibility filter drops
|   `-- demo-rebook.js           end-to-end Phase 4 ranking on live data
|-- test/                          Node built-in test runner suites
`-- mobile/
    |-- AGENTS.md                  Expo SDK 54 instruction
    |-- README.md                  physical-device setup and app notes
    |-- package.json               Expo/React Native dependencies
    |-- app.json                   Expo app configuration
    |-- App.js                     bottom tabs and nested navigation stacks
    |-- .env.example              Expo API URL template
    `-- src/
        |-- api/                   axios client and route wrappers
        |-- context/AuthContext.js SecureStore token/session state
        |-- config/categories.js   shared search/filter/sort category config
        |-- screens/               one screen per app flow
        |-- components/            result rows, sheets, and reusable UI
        |-- theme/                 colors, spacing, and Space Grotesk fonts
        `-- utils/date.js
```

`generate.py` is a legacy one-off Sabre auth test, not application code. See the
security warning below before touching or running it.

## Runtime configuration

Backend requirements:

- Node.js `>=20.6.0` according to the root package.
- MongoDB reachable through `MONGO_URI` for accounts/history and their tests.
- Sabre credentials for real flight search.

Optional provider keys are absent by default and the app runs without them;
the provider port falls back to the simulator. Verify any key before trusting an
adapter built on it:

```powershell
npm run probe:providers
```

Verified 2026-08-25: **OpenSky is reachable with no credentials at all**
(`GET /api/states/all`, HTTP 200). Duffel and AeroDataBox report SKIP until
`DUFFEL_ACCESS_TOKEN` and `RAPIDAPI_KEY` are set.

Backend environment keys in `.env.example`:

```dotenv
PORT=4000
SABRE_CLIENT_ID=
SABRE_CLIENT_SECRET=
SABRE_BASE_URL=https://api-crt.cert.havail.sabre.com
JWT_SECRET=
JWT_EXPIRES_IN=7d
MONGO_URI=mongodb://localhost:27017
MONGO_DB_NAME=travel_disruption_concierge
```

Do not rely on the development JWT fallback in `src/config.js` outside local
development. Generate a strong `JWT_SECRET` as shown in `.env.example`.

There is a current port-default mismatch to keep in mind:

- `src/config.js` defaults to port `4001` when `PORT` is absent.
- Root `.env.example` specifies port `4000`.
- `mobile/.env.example` points to port `4001`.

The backend's actual `PORT` and mobile `EXPO_PUBLIC_API_BASE_URL` must match.
Prefer explicit values in both local `.env` files instead of relying on a
default. Do not commit either `.env` file.

Mobile environment:

```dotenv
EXPO_PUBLIC_API_BASE_URL=http://<computer-LAN-IP>:<backend-port>
```

The current local mobile environment may also define
`EXPO_PACKAGER_HOSTNAME`. A physical phone cannot use `localhost` to reach the
development computer. Phone and computer must share a network, and the backend
port must be allowed through the local firewall.

## Exact local startup

From the repository root on Windows PowerShell:

```powershell
npm install
Copy-Item .env.example .env
# Fill the values in .env without sharing or committing secrets.
# Start local MongoDB, or point MONGO_URI at a reachable MongoDB instance.
npm run dev
```

The control panel is at `http://localhost:<PORT>/`. API discovery is at
`http://localhost:<PORT>/api`.

In a second terminal:

```powershell
Set-Location mobile
npm install
Copy-Item .env.example .env
# Set EXPO_PUBLIC_API_BASE_URL to the computer's LAN IP and backend port.
npx expo start
```

The equivalent root command is `npm run mobile`. Always run Expo/npm dependency
commands from `mobile/` or through that root script. Never install Expo in the
backend root. Expo is pinned to SDK 54 to match the available Expo Go client.
Recent Expo tooling may warn if Node is below `20.19.4`; upgrading Node is the
first troubleshooting step if Metro behaves unexpectedly.

## HTTP API currently exposed

All paths are mounted directly; there is no `/api` prefix for the functional
routes. `GET /api` only returns endpoint discovery metadata.

| Method and path | Auth | Current behavior |
|---|---|---|
| `GET /health` | None | Liveness, server time, Sabre-configured boolean |
| `POST /auth/signup` | None | Creates Mongo user, returns JWT and public user |
| `POST /auth/login` | None | Verifies password, returns JWT and public user |
| `GET /auth/me` | Required | Restores the current user from JWT |
| `GET /search/flights` | Optional | Real Sabre InstaFlights, normalized, implausible itineraries dropped; response adds `filtered` count; logs signed-in search |
| `GET /search/hotels` | Optional | Five deterministic mock listings; logs signed-in search |
| `GET /search/cabs` | Optional | Four deterministic mock listings; logs signed-in search |
| `GET /tracking/:flightNumber` | None | Sabre status attempt; mock only when provisioned route returns 404/null |
| `GET /history` | Required | Current user's searches, newest first |
| `POST /simulator/demo/seed` | None | Seeds `demo-trip` fixture |
| `POST /simulator/trips/:tripId/seed` | None | Seeds custom `{ nodes: [...] }` |
| `POST /simulator/trips/:tripId/nodes/:nodeId/cancel` | None | Sets node status to `CANCELLED` |
| `POST /simulator/trips/:tripId/flights/:flightId/delay` | None | Sets delay and projected arrival from `{ minutes }` |
| `POST /simulator/bookings/fail-next` | None | Arms exactly one simulated booking failure |
| `GET /simulator/trips/:tripId/analyse` | None | Returns Watcher events and impact arrays |
| `POST /simulator/trips/:tripId/recover` | None | Runs the whole loop: detect, assess, search real alternatives, score, apply policy, book safely; returns ranked options, the decision, execution attempts, the audit trail, plus `recoveryId` and `auditPersisted` |
| `GET /simulator/trips/:tripId/audit` | None | The durable audit trail for one trip, newest first |
| `GET /simulator/audit` | None | Recent audit entries across all trips (`?limit=`) |
| `GET /simulator/state` | None | Returns current in-memory trips and bookings |

Search query names are case-sensitive as currently implemented:

- Flights: `origin`, `destination`, `departuredate`.
- Hotels: `destination`, `checkIn`, `checkOut`.
- Cabs: `destination`.

Search endpoints remain browseable without an account. A valid bearer token
adds history logging; an invalid token is ignored by optional auth. History and
the authenticated mobile tabs require a valid bearer token.

## Data shapes

### Simulator trip

```js
{
  id: 'trip-id',
  nodes: [{
    id: 'node-id',
    type: 'FLIGHT' | 'GROUND' | 'HOTEL' | 'COMMITMENT',
    status: 'CONFIRMED' | 'CANCELLED',
    dependsOn: ['upstream-node-id'],
    reversible: true,
    refundable: true,
    // type-specific schedule/location fields
  }]
}
```

The `dependsOn` edges are the heart of impact traversal. Detection uses a
hard-coded minimum connection time of 45 minutes and compares an upstream
flight's `projectedArrival` (falling back to `scheduledArrival`) with the next
flight's `scheduledDeparture`.

### Member message

`src/agent/notifier.js` composes one message per recovery, deterministically,
from the recovery result itself - never an LLM. The message states money spent
and actions taken on the member's behalf, so it must say exactly what the audit
trail says; a generated paraphrase that drifts from the record is a liability.

| Severity | When | Leads with |
|---|---|---|
| `REBOOKED` | ACT, everything handled | the new flight and fare |
| `REBOOKED_WITH_QUESTION` | SPLIT, or the old ticket could not be released | what was done, then the one open item |
| `ACTION_REQUIRED` | nothing was booked | **that the original ticket is intact** |

It returns structure (`headline`, `body`, `actions`), not a blob, so a push
notification, an email and an in-app card can each render it properly. Delivery
is not implemented: no channel sends this yet.

### Option scoring (Phase 4)

Scores are a **penalty in equivalent minutes of inconvenience**, so lower is
better and zero means "as good as what the member already had". Weights live in
`SCORING_WEIGHTS` in `src/agent/options.js`:

| Factor | Weight |
|---|---|
| Arrival later | 1 per minute |
| Arrival earlier | 0.25 per minute, capped at 120 |
| Extra stop | 45 each |
| Cabin downgrade | 120 per class |
| Cabin upgrade | 0 - never chased |
| Different airline | 30 |
| Fare above original | 0.5 per currency unit |
| Fare below original | 0.25 per currency unit |

Every score carries a `breakdown` naming each factor, its points and a plain
explanation; that array is what the audit trail records.

**Cost is scored, never filtered.** The cost cap governs autonomy, not
feasibility, so an over-cap option stays on the ranked list and Phase 5 decides
whether to act or escalate. Filtering it here would remove a choice that
belongs to the member.

Hard viability rules do remove an option: departing before the member can reach
the airport, arriving after the latest useful arrival, landing outside the
acceptable airports, or having no seats. Ties break on price, then departure,
then id, so ordering never depends on provider response order.

### Impact classifications

- Flight -> `REBOOK_FLIGHT`.
- Refundable hotel -> `SHIFT_HOTEL`.
- Non-refundable hotel -> `ESCALATE`.
- Ground -> `RETIME_GROUND`.
- Commitment -> `ESCALATE`.
- Unknown type -> `REVIEW`.

### Mongo documents

- `users`: UUID `id`, normalized lowercase `email`, bcrypt `passwordHash`, ISO
  `createdAt`; unique index on `email`.
- `history`: UUID `id`, `userId`, category, raw query object, result count, ISO
  `createdAt`; indexed by user and newest-first time.
- `audit`: UUID `id`, `recoveryId`, `tripId`, `sequence`, ISO `at`, `action`,
  `outcome`, `authorisedBy`, `detail`, plus optional `optionId`, `bookingId`,
  `idempotencyKey`, `nodeId`, `attempt`, `oldTicketRetained`. Indexed by
  `{tripId, at}` and by `recoveryId`. Append-only: `sequence` preserves the real
  order of actions, which is what evidences the book-before-release rule.
  Audit writes are **best-effort by design** - a failed write is reported via
  `auditPersisted:false`, never thrown, because losing the paperwork must not
  fail a rebooking that already succeeded.

Simulator trips, bookings, idempotency results, and the failure flag are
process-memory only and disappear on restart.

## Sabre-specific facts

- Auth requires **double Base64**: encode client ID and secret separately, join
  them with `:`, then Base64-encode that joined value.
- Token cache refreshes when less than 60 seconds remain.
- The current trial account supports InstaFlights at `/v1/shop/flights`.
- Bargain Finder Max `/v2/shop/flights` is not provisioned for this account.
- Hotel endpoint paths tried so far return gateway 404, so the provider uses
  mock hotels.
- Flight-status endpoint paths tried so far return gateway 404, so the current
  configured path returns `null` on 404 and the route uses deterministic mock
  status.
- A Sabre InstaFlights 404 with JSON message `No results were found` is treated
  as an empty result, not a missing route.
- Tracking does **not** fall back on every failure: authentication, network, or
  non-404 Sabre errors currently become HTTP 500 responses.
- Sabre distinguishes two auth failures, and the wording is the diagnostic:
  `Wrong clientID or clientSecret` means the credential format parsed and the
  values were rejected; `Credentials are missing or the syntax is not correct`
  means the encoding itself is wrong. Verified 2026-08-24 that only `POST
  /v2/auth/token` with double base64 produces the former, so `src/sabre/auth.js`
  uses the correct scheme.
- Credentials were rotated again on 2026-08-24 and now authenticate. The
  earlier pair was rejected; if calls start failing with `invalid_client`,
  regenerate CERT credentials rather than editing the auth code.
- Provisioning verified live on 2026-08-24 with `npm run probe:sabre` -
  **11/11 Part 1 products reachable** on this CERT account:

| Product | Verified path | Required query |
|---|---|---|
| InstaFlights Search | `GET /v1/shop/flights` | origin, destination, departuredate |
| Lead Price Calendar v2 | `GET /v2/shop/flights/fares` | origin, destination, lengthofstay |
| Lead Price Calendar v1 | `GET /v1/shop/flights/fares` | + departuredate, returndate, lengthofstay |
| Fare Range | `GET /v1/historical/flights/fares` | origin, destination, earliestdeparturedate, latestdeparturedate, lengthofstay |
| Low Fare History | `GET /v1/historical/shop/flights/fares` | origin, destination, departuredate, returndate |
| Low Fare Forecast | `GET /v1/forecast/flights/fares` | origin, destination, departuredate, returndate |
| Multi-Airport City | `GET /v1/lists/supported/cities` | country |
| Airports at Cities | `GET /v1/lists/supported/cities/{mac}/airports` | - |
| Airline Lookup | `GET /v1/lists/utilities/airlines` | airlinecode |
| City Pairs Lookup | `GET /v1/lists/supported/shop/flights/origins-destinations` | origin |
| Aircraft Equipment | `GET /v1/lists/utilities/aircraft/equipment` | aircraftcode |

- The Overview docs for Lead Price Calendar, Fare Range, and Multi-Airport City
  say they need a signed Travel Insight Engine Amendment. That warning did not
  hold for this CERT account - all three answered. Probe before believing a
  documented entitlement gate.
- **Fare Range is not under `/shop/`.** Its path is `/v1/historical/flights/fares`,
  and `/v1/shop/flights/fares` - which looks like it - is really Lead Price
  Calendar v1. Sabre returns HTTP 200 either way, so only the response shape
  (`FareData`/`MedianFare` vs `FareInfo`/`LowestFare`) tells the two apart.
  `src/sabre/probe.js` asserts those marker fields for exactly this reason.
- Sabre reports missing mandatory query parameters **one at a time** in 400
  `ERR.RAF.VALIDATION` messages; iterate the 400s to discover a full param set.
- Low Fare History returns `"N/A"` for every shop date except the current one on
  this account, so treat it as effectively empty.
- Parts 2-4 probed 2026-08-25: **only InstaFlights v2 is reachable.** Flight
  Status/FLIFO (5 paths), Flight Schedules, Create PNR, Enhanced Seat Map,
  Alternate Date Search, Revalidate Itinerary and Bargain Finder Max are all
  absent. Get Booking exists but refuses this account.

| Product | Path | Result |
|---|---|---|
| InstaFlights v2 | `GET /v2/shop/flights` | available, same `PricedItineraries` shape |
| Get Booking | `POST /v1/trip/orders/getBooking` | HTTP 200 carrying `UNAUTHORIZED_ACCESS` |
| Bargain Finder Max | `POST /v2/shop/flights` | `No service exists` |
| Flight Status / FLIFO | 5 paths tried | gateway 404, no route |
| Flight Schedules | 4 paths tried | `No service exists` |
| Create PNR / Seat Map / Alternate Date / Revalidate | - | gateway 404, no route |

- **`GET /v2/shop/flights` is InstaFlights v2, not Bargain Finder Max.** Probing
  BFM with GET returns 200 and looks provisioned; only `POST` with a real
  `OTA_AirLowFareSearchRQ` body reveals `No service exists`. Method matters as
  much as path when identifying a product.
- **HTTP 200 is not proof of success.** Get Booking answers 200 with
  `errors[].category === 'UNAUTHORIZED'`. `src/sabre/probe.js` inspects the body
  for embedded errors before calling anything available.
- Consequence for the roadmap: there is **no Sabre flight-status feed on this
  account**, so the Phase 2 Watcher cannot be driven by Sabre. Part 3 monitoring
  needs a third-party feed (AeroDataBox/AviationStack/OpenSky) or the simulator.
  Seat maps and real booking stay simulated, as the architecture already assumes.

## Provider selection

| Env var | Default | Alternatives |
|---|---|---|
| `SEARCH_PROVIDER` | `duffel` | `sabre` |
| `BOOKING_PROVIDER` | `duffel` | `simulator` |
| `STATUS_PROVIDER` | `simulator` | - |
| `POLICY_COST_CAP_CURRENCY` | `EUR` | must match what the search provider quotes |

`src/providers/search.js` is the single search entry point: it picks the
provider, normalizes, and applies the plausibility filter, so the mobile route
and the recovery loop cannot tell the providers apart.

**Route coverage is why Duffel is the default.** Verified 2026-08-25 over ten
routes: Sabre returned data for 1 (JFK-LAX); Duffel returned offers for all 10,
including DEL-BOM (165 offers, Air India), BLR-DEL (135) and HYD-DEL (102),
which Sabre has zero coverage for.

`BOOKING_PROVIDER=duffel` requires `SEARCH_PROVIDER=duffel` - a Duffel order
needs a Duffel offer id. `providerMismatch()` warns at startup.

**Currency matters.** Duffel test mode quotes EUR while Sabre CERT quotes USD.
The policy engine refuses to compare across currencies rather than inventing a
rate, so `POLICY_COST_CAP_CURRENCY` and the trip fixture must match the active
provider or every recovery escalates on `COST_CAP`.

## Duffel-specific facts

Verified live 2026-08-25 with a `duffel_test_` token. Duffel fills the three
gaps this Sabre account cannot: a real seat map, a bookable order, and a
release path.

| Step | Endpoint | Result |
|---|---|---|
| Search | `POST /air/offer_requests?return_offers=true` | 27 offers for JFK-LAX |
| Seat map | `GET /air/seat_maps?offer_id=` | 22 rows, 76/192 bookable |
| Book | `POST /air/orders` | confirmed, booking reference returned |
| Confirm | `GET /air/orders/{id}` | independent check before any release |
| Release | `POST /air/order_cancellations` then `/actions/confirm` | cancelled, refunded |

- **Duffel's `Idempotency-Key` header does NOT deduplicate `POST /air/orders`.**
  A repeat call with the same key returns `422 offer_request_already_booked`.
  That is a safe failure - no double charge - but the wrong shape for this
  agent: the executor reads a throw as "this candidate failed" and moves on, so
  a retried network call would book a **different flight**. `src/duffel/adapter.js`
  therefore keeps its own idempotency map and answers a retry from it, the way
  the simulator does. Do not remove that map on the assumption the vendor header
  covers it.
- An offer request can be booked **once**. Offers also expire within minutes, so
  the executor's fall-through-to-the-next-candidate behaviour matters far more
  against Duffel than against the simulator.
- Seat maps exist for **Duffel Airways (`ZZ`)** offers in test mode; partner
  offers such as BA or AA return an empty list. That is not an error.
- Prices come back in EUR in test mode, so a policy cost cap in USD will
  correctly refuse to compare them. Set the cap's currency to match the search
  before expecting an ACT verdict.
- `src/duffel/client.js` refuses any token not starting with `duffel_test_`
  unless `DUFFEL_ALLOW_LIVE=yes-i-understand`. This project books automatically;
  a live token would create real tickets.
- Selecting the adapter is configuration, not code: `BOOKING_PROVIDER=duffel`.
- **Not every offer is bookable.** A live recovery hit `422 Requested offer is no
  longer available` on two candidates and a `502 Internal Airline Error` on a
  third before the fourth succeeded. This is normal, and it is exactly what the
  executor's fall-through exists for - but it means `maxAttempts` must be
  generous (currently 6) and the ranked list must contain genuinely different
  flights.
- Partner-airline offers (IB, AA, AS, CM) **are** bookable in test mode; only
  seat maps are Duffel Airways-only. An earlier assumption that partner offers
  could not be booked was wrong - Iberia booked fine.
- An offer request can be booked **once**.

Exercise the whole path:

```powershell
npm run demo:duffel
```

## Mobile app behavior

Navigation has five bottom tabs:

- **Home:** public search entry and recent signed-in history.
- **Trips:** auth-gated; honest empty state until booking/trip APIs exist.
- **Track:** public flight-number lookup.
- **History:** auth-gated search history.
- **You:** auth-gated account, local autonomy limits, notification toggles,
  and logout.

The Home stack contains Search, Results, Item Details, and Booking. Results use
`mobile/src/config/categories.js` so one configuration drives fields, API call,
text matching, filters, sorting, and row component for flights/hotels/cabs.

- Flight sort: price, duration, departure, repair-odds heuristic.
- Flight filters: stops, departure time band, airlines.
- Hotel sort/filter: price, rating, minimum rating.
- Cab sort/filter: price, ETA, minimum capacity.
- JWT is stored as `auth_token` in Expo SecureStore and attached by an axios
  request interceptor.
- Autonomy limits and channel preferences are local-only SecureStore state
  under `autonomy_limits_v1`; no backend profile endpoint consumes them yet.

## Tests and verification

Run all backend tests with:

```powershell
npm test
```

The test script uses `.env.test`, whose test database name is
`travel_disruption_concierge_test`. The Mongo-backed store tests delete records
from their test collections, so never point test configuration at real data.

Probe the account's Sabre provisioning with:

```powershell
npm run probe:sabre
npm run probe:sabre -- --origin=DEL --destination=BOM --days=45
```

It walks each candidate product through several path variants, classifies every
response, and writes `sabre-probe-report.json`. It needs network and real
credentials, so it lives in `scripts/` and is deliberately outside `npm test`.
InstaFlights acts as the control: if it fails, suspect credentials rather than
provisioning. The pure classifier is unit tested in `test/sabre.probe.test.js`.

Inspect what the plausibility filter removes from a live search:

```powershell
npm run check:plausibility -- --origin=JFK --destination=LAX
```

On 2026-08-25 that kept 47 itineraries and dropped 3, each a JFK-FLL/FLL-LAX
routing whose second segment crossed 3 hours of timezones in 30 minutes.

Exercise the Option Engine end to end against live Sabre data:

```powershell
npm run demo:rebook
```

It searches, drops implausible itineraries, treats the earliest nonstop as
cancelled, and prints the ranked replacements with a per-factor breakdown.

Verification on 2026-08-25 (Duffel-primary run):

- Full suite: 202 tests passed, 0 failed.
- Full loop verified against real APIs end to end: Duffel search returned 27
  offers collapsing to 5 distinct flights; attempts 1-3 failed (two expired
  offers, one airline 502) with the old ticket retained each time; attempt 4
  booked real order `ord_...`; the old ticket was released only after
  confirmation; hotel and ground were adjusted; the commitment was escalated.
- `GET /search/flights?origin=DEL&destination=BOM` returns 165 real Air India
  results - a route Sabre cannot serve at all.

Verification on 2026-08-25 (Duffel run):

- Full suite: 196 tests passed, 0 failed.
- Duffel verified live end to end through the provider port: search, seat map,
  book, independent confirm, idempotent retry (same order returned), release.
- `npm run probe:providers`: OpenSky and both Duffel endpoints reachable;
  AeroDataBox returns 403 `You are not subscribed to this API` - the RapidAPI
  key is valid but the AeroDataBox API itself needs a (free) subscription.

Verification on 2026-08-25 (earlier run):

- Full suite: 168 tests passed, 0 failed.
- Full recovery loop verified live end to end against real Sabre data: a
  cancelled `flight-out` produced 47 real candidates, `SPLIT` (act on flight,
  hotel and ground; escalate the commitment), and `RECOVERED`.
- With a forced failure armed: attempt 1 failed with the old ticket retained,
  attempt 2 booked, and only then was the old ticket released.
- Trip state afterwards confirmed bounded autonomy: hotel and ground `ADJUSTED`,
  the escalated commitment left `CONFIRMED` and untouched.

Verification on 2026-08-25:

- Full suite: 115 tests passed, 0 failed.
- Plausibility filter verified against live InstaFlights data.
- Phase 4 verified end to end on live JFK-LAX: 47 usable itineraries, 20 viable
  replacements ranked, 26 correctly refused for departing before the member
  could reach the airport.

Verification on 2026-08-24:

- Full suite: 69 tests passed, 0 failed, Mongo store tests included (a local
  `mongod` was running for this run).
- Live Sabre probe: 11/11 Part 1 products reachable; 1/9 across parts 2-4.
  See the provisioning tables under Sabre-specific facts.
- InstaFlights data quality checked live: nonstop times, carriers and fares are
  plausible, but **only 1411 city pairs are supported (684 US-US) and there are
  zero domestic India routes** - DEL-BOM and BLR-DEL return "No results were
  found". Demo on US routes.
- Some connecting itineraries carry impossible segment times (a 30-minute
  FLL-LAX leg). `src/normalize/plausibility.js` now drops these before they
  reach the app or `src/agent/detection.js`, whose 45-minute connection check
  would otherwise draw confident wrong conclusions.
- **Only `JFK-LAX` returns data on this account.** Verified 2026-08-25 across
  12 routes and 7 departure dates from +1d to +150d: JFK-LAX returns 30 results
  every time, and DFW-ORD, LAX-JFK (the reverse!), JFK-MIA, ATL-LAX, ORD-LAX,
  JFK-SFO, BOS-LAX, JFK-LHR, SFO-JFK, LAS-JFK and DEN-JFK all return zero on
  every date. City Pairs Lookup lists 1411 *supported* pairs, which is not the
  same as *populated* - do not infer coverage from it. **Every live-data demo
  must use JFK-LAX**; anything else needs mock data.

Verification on 2026-08-19:

- 42 non-Mongo tests passed: auth helpers, JWT middleware, detection, impact,
  simulator, Sabre token behavior, normalization, and mock data.
- The full suite could not complete because no local `mongod` process was
  running. The 9 Mongo store tests were not verified in that run.
- There are no route-level HTTP integration tests, live Sabre tests, mobile
  automated tests, or end-to-end recovery tests yet.

A green unit suite is not proof that Mongo, Sabre credentials, LAN networking,
Expo Go, or the end-to-end member flow works. Verify external services and the
actual UI flow separately.

## Demo procedure for what exists today

1. Start MongoDB and the backend.
2. Open the backend root URL in a browser.
3. Click **Seed demo trip**.
4. Cancel `flight-out`, or delay it by 90 minutes.
5. Watch the right panel update on its 2-second poll.
6. Confirm the Watcher emits a cancellation or connection-at-risk event.
7. Confirm Impact Analyser lists downstream flight, hotel, ground, and
   commitment consequences.
8. Click **Run recovery**. The Recovery panel shows the real alternatives it
   considered with per-factor scores, the ACT/SPLIT/ESCALATE verdict, the
   booking attempts, and the audit trail.
9. To show the safety property: click **Force next booking failure** before
   **Run recovery**, and watch attempt 1 fail with the old ticket retained.

The demo now genuinely searches alternatives, scores them, applies policy,
rebooks, releases the old ticket and writes an audit trail. It still does not
notify a member over any channel, and the audit trail is per-request rather than
durably stored.

## Known risks and traps

### Immediate credential issue

The tracked legacy `generate.py` contains hard-coded Sabre credentials. Treat
those credentials as compromised: rotate/revoke them in Sabre, replace local
`.env` values, and remove or sanitize the script. Never copy its credential
values into documentation, chat, tests, commits, or logs. Do not run the script
as part of normal development.

### Other important traps

- Never read, print, or commit root/mobile `.env` values.
- Do not confuse the planned PostgreSQL/Redis architecture with the current
  Mongo-plus-memory implementation.
- Do not call the simulator's unused booking helpers proof of a safe recovery
  loop; orchestration is absent.
- Do not call a build/test pass proof of working Sabre credentials or Mongo.
- Do not change Sabre endpoints based only on generic provider docs; confirm
  which products this exact trial account has provisioned.
- Do not run Expo tooling from the backend root.
- Keep Expo SDK 54 unless the test phone's Expo Go version and the versioned
  migration instructions have been verified.
- Preserve user changes in a dirty working tree. Inspect `git status` and the
  relevant diff before editing.

## Recommended next implementation order

1. Resolve the credential exposure and align backend/mobile example ports.
2. Build Phase 4 option filtering and deterministic scoring with pure tests.
3. Build Phase 5 bounded-autonomy policy decisions with pure tests.
4. Build Phase 6 safe executor: idempotent book, confirm, then release old;
   preserve old booking on failure and try the next candidate.
5. Expose recovery/trip APIs and connect the simulator panel end to end.
6. Add durable audit/trip storage, then SSE progress and mobile Trips UI.
7. Add notifications and external-service fallbacks.
8. Add route integration, live-service smoke, mobile, and end-to-end tests.

## How to work efficiently in future chats

- Start with this file and `git status`.
- Read only the files named in the relevant section above plus their direct
  tests.
- For backend behavior, trace route -> provider/store -> pure/domain module.
- For mobile behavior, trace screen -> category config/endpoint -> backend
  route. Also read `mobile/AGENTS.md` before changing mobile code.
- State whether a conclusion is about current code, configured credentials,
  provider provisioning, or a live end-to-end test; these are different kinds
  of evidence.
- Update this context in the same change whenever the summarized behavior stops
  being true.
