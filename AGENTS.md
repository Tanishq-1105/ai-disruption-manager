# Autonomous Travel Disruption Manager - Project Context

> Read this file first in a new coding chat. It is the maintained, compact
> context for the repository. Inspect only the source files relevant to the
> requested change instead of rereading the whole project.

For the latest session status, verification results, open issues, and prioritized
work plan, read [SESSION_STATUS.md](./SESSION_STATUS.md) next.

Last context update: 2026-09-13

## Source-of-truth order

1. The current source code and `package.json` files are authoritative.
2. This file summarizes the current implementation and intended constraints.
3. `README.md` contains operator-facing setup notes.
4. `CLAUDE.md` contains the original product vision and roadmap. Some of its
   stack choices describe the target architecture, not code that exists today.
5. For every change under `mobile/`, also follow `mobile/AGENTS.md`. The mobile
   app uses Expo SDK 57 to match the test phone (upgraded at the user's request).

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

- **Information/search:** Duffel test offers by default; Sabre is an alternative
  where its trial account supports the route. Sandbox offers are API-backed
  test data, not live market fares.
- **Actions/ticketing:** Duffel test orders for flight replacements; an in-memory
  simulator for demo trips, disruptions, original tickets, and dependents.

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
- Mock hotel/cab search and simulator flight-status fixtures; member tracking
  never silently falls back to those fixtures.
- MongoDB-backed member accounts and search history.
- JWT signup, login, session restore, required auth, and optional auth.
- In-memory trip graph and simulated booking state.
- Demo trip seeding, cancellation, delay, and one-shot booking-failure injection.
- Phase 2 Watcher: cancellation and connection-risk detection.
- Phase 3 Impact Analyser: downstream graph traversal and action classification.
- Phase 4 Option Engine: viability filtering and deterministic, explainable
  scoring of replacement flights.
- Phase 5 Policy Engine: bounded autonomy returning ACT, SPLIT or ESCALATE.
- Phase 6 Safe Executor: refreshed-offer policy/viability checks, idempotent
  booking, independent confirmation before release, fallback only after definite
  rejection, and an audit entry per action. Pending outcomes pause purchases.
- Hotel/ground adjustments run only after successful flight recovery; otherwise
  they are recorded as SKIPPED. Failed adjustments remain visible in the message.
- End-to-end recovery loop wired to the control panel via
  `POST /simulator/trips/:tripId/recover`.
- Recovery updates the flight node to its confirmed replacement and serializes
  overlapping recovery requests for the same provider/trip within one process.
- Durable Mongo-backed audit trail (`audit` collection), written per recovery
  and readable after the request that created it.
- Notifier: composes the single member-facing message, returned in the recovery
  response and rendered in the control panel.
- Duffel adapter behind the provider port: sandbox search, seat maps, order
  creation, independent order lookup, reconciliation and cancellation. Recovery
  verifies the order ID, paid/confirmed state, exact fare and itinerary before
  releasing the original ticket.
- **Duffel is the default provider for search and booking.** Sabre stays wired
  and one env var away (`SEARCH_PROVIDER=sabre`, `BOOKING_PROVIDER=simulator`).
- Physical-plausibility filtering of search results before they reach the app
  or the agent core.
- Mobile search/results/filter/sort/details flows, auth, and recent search history.
- Authenticated Duffel sandbox checkout for one adult, with passenger details,
  fresh server quotes, explicit review of changed fares, and independent order
  confirmation. Confirmed bookings automatically appear in Protected Trips.
- Mongo-backed member trips, durable request claims, ownership checks, and
  reconciliation of ambiguous order outcomes without another purchase.
- Track reads the saved Duffel order and airline-initiated schedule changes.
  It does not fabricate live flight status or accept schedule changes.
- Four mobile tabs: Home, Trips, Track, You; locally stored autonomy/notification
  preferences. No History tab and no duplicate parent/child screen names.

The localhost control panel can now query confirmed Duffel sandbox member
bookings by exact airline and flight number, simulate a cancellation or delay
for all matching passengers, and run the existing safe recovery independently
per passenger. A saved member trip is updated only after the replacement is
independently confirmed. Recovery claims/checkpoints for this batch remain
process-local and are the next hardening task.

### Not implemented yet

- A real booking/payment/ticketing API for production. Duffel's sandbox covers
  the booking path in test mode; no live ticketing adapter exists.
- Durable recovery claims/checkpoints and restart reconciliation for the new
  persisted-member recovery bridge.
- Automatic monitoring of member trips and a general live flight-status feed.
- LangGraph orchestration.
- PostgreSQL trip/audit storage and Redis search caching described by the
  original target architecture.
- SSE progress updates.
- WhatsApp/email/SMS delivery. The message is composed; no channel sends it.
- AWS deployment, production ticketing adapter, and hardening/circuit breakers.

The control panel's **Force next booking failure** button affects both recovery
booking adapters through the provider port. It fails one new booking attempt
before the order POST (the executor may already have refreshed its offer). Cached idempotent retries return their booking
without consuming the flag; the next new attempt consumes it.

Re-seeding a trip clears that trip's simulator bookings and simulator idempotency
keys. Duffel's adapter has its own separate in-memory idempotency map.
Without re-seeding, a second simulator demo can reuse the first run's keys,
return a cached booking, and leave the armed failure unconsumed.

Member checkout creates actual Duffel **test orders** and persistent member
trip records. It only accepts a `duffel_test_` token, even if the legacy live
adapter override is enabled. It uses a test balance and produces no usable
flight ticket or real charge. Hotel/cab checkout is not implemented.

After a confirmed replacement, recovery calls the provider's `replaceFlight`
operation to update the node's booking id/reference, itinerary, actual fare,
and `CONFIRMED` status. Schedules are stored in UTC and stale delay projections
are cleared; graph ids/edges are preserved. An `UPDATE_FLIGHT` audit entry
records the change. This also happens if releasing the old ticket failed, so
holding two tickets does not cause another purchase. Failed, pending, or
unauthorized execution leaves the cancelled node and original ticket intact.
An unresolved order returns `REVIEW_REQUIRED`, `pendingBookingId` when known,
and a reason. Another recovery request checks that same attempt without search
or another POST; it can resume after independent confirmation.

Repeating recovery of the repaired flight does not search or book again.
Requests for the same provider/trip are serialized and reread the graph after
the preceding request completes. Pending attempts are scoped to that simulator
flight node; a completed attempt is cleared only after the replacement is saved.
A later cancellation of the replacement can start a new recovery. A failed graph
update can reuse the already confirmed purchase without repeating booking/release.
These protections and Duffel's in-flight/ambiguous-result cache remain process-local;
durable recovery claims and restart reconciliation are not implemented. Do not
restart or reseed to clear an unresolved order: inspect/reconcile it first.
Member checkout has its own durable Mongo request state, described below.

## Architecture at a glance

```text
Member Expo app --------------------+
                                     |
Judge control panel in public/ ------+--> Express routes
                                           |
                       +-------------------+-------------------+
                       |                                       |
                 provider port                         member/auth/history/audit stores
             src/providers/index.js                         MongoDB
                       |
          +------------+-------------+-------------------+
          |            |             |                   |
       Duffel       Sabre         mock data       in-memory simulator
   test search/     search                        demo trips/disruptions
     booking                                             |
                                               agent phases 2 through 6
```

Current search flow:

```text
mobile search -> /search/* -> optional JWT -> provider
  -> Duffel test flight search (or Sabre) or mock hotel/cab data
  -> normalize where needed -> log history if signed in -> response
```

Current member booking flow:

```text
sign in -> server refreshes offer -> review fare/passenger -> explicit confirmation
  -> atomic Mongo request claim -> recheck fare/itinerary -> Duffel test order
  -> independent order lookup -> saved Protected Trip -> Track order/changes
```

Current simulator flow:

```text
seed demo -> cancel/delay a node -> panel polls /analyse every 2 seconds
  -> pure Watcher events -> pure downstream impact classifications
```

Current simulator recovery flow:

```text
Notice -> Assess -> Pick -> Policy -> Refresh offer -> Recheck policy/viability
  -> Book new -> Independently confirm order/fare/itinerary -> Release old
  -> Update flight -> Adjust dependents -> Compose message and persist audit
Pending/unknown order -> pause -> read-only reconciliation on the next recovery
```

## Non-negotiable design and safety rules

- Route external travel and action calls through the provider port.
- Keep all money, scoring, policy, and booking decisions deterministic and
  explainable. An LLM may not decide spending or booking behavior.
- **Confirm the new ticket before releasing the old ticket.** Only a definitive
  rejection permits fallback. A pending order, timeout, unreadable confirmation,
  or mismatched order pauses purchases and retains the original and dependents.
- Recovery providers must implement `prepareFlight`, `bookFlight`, `getBooking`
  and `cancelBooking`. The prepared quote is the exact quote used for purchase;
  the adapter must not refresh its price again after policy authorisation.
  Only an error explicitly marked `bookingOutcome: 'NOT_CREATED'` permits another
  candidate. Unknown errors default to review; Duffel can reconcile by metadata.
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
|   |-- bookings/                member quote, checkout, validation, reconciliation
|   |-- simulator/
|   |   |-- state.js              in-memory trips/bookings/idempotency/fail flag
|   |   `-- demoTrip.js           linked demo fixture
|   |-- duffel/
|   |   |-- client.js             raw Duffel REST calls + live-token guard
|   |   |-- adapter.js            recovery provider shape, in-memory idempotency
|   |   `-- member.js             sandbox checkout and order/change tracking
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
|   |-- store/                     Mongo users, history, audit, memberTrips
|   `-- routes/                    health/auth/search/bookings/trips/tracking/history/simulator
|-- scripts/
|   |-- probe-sabre.js           live provisioning probe (network, needs .env)
|   |-- probe-providers.js       feasibility probe for Duffel/AeroDataBox/OpenSky
|   |-- check-plausibility.js    shows what the plausibility filter drops
|   |-- demo-rebook.js           end-to-end Phase 4 ranking on live data
|   `-- smoke-member.js          live sandbox member flow with owned test cleanup
|-- test/                          Node built-in test runner suites
`-- mobile/
    |-- AGENTS.md                  Expo SDK 57 instruction
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
- MongoDB reachable through `MONGO_URI` for member trips/accounts/history/audit.
- `DUFFEL_ACCESS_TOKEN` with a test token for default search, checkout, tracking.
- Sabre credentials only when using Sabre search.

Missing provider credentials do not make checkout or tracking work through a
simulator fallback. Check provider configuration explicitly:

```powershell
npm run probe:providers
```

Backend environment keys in `.env.example`:

```dotenv
PORT=4001
SEARCH_PROVIDER=duffel
BOOKING_PROVIDER=duffel
STATUS_PROVIDER=duffel
DUFFEL_ACCESS_TOKEN=
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

The backend default and both environment templates use port `4001`.

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

On Ubuntu, install dependencies with `npm ci` and `npm --prefix mobile ci`
from the root, then run `npm run dev` and `npm run mobile` in separate terminals.
A hosted MongoDB connection does not need a local MongoDB installation. Use
`hostname -I` to find the phone's LAN address. See README.md's Ubuntu section
for restart instructions and SESSION_STATUS.md for the workstation state.
The test script uses Node's automatic test discovery (`--test` without a
directory argument), which works with Node 24 as well as the earlier runtime.

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
backend root. Expo uses SDK 57 to match the available Expo Go client. SDK 57
requires Node.js 22.13 or newer; the Ubuntu workstation uses Node.js 24.20.0.

## HTTP API currently exposed

All paths are mounted directly; there is no `/api` prefix for the functional
routes. `GET /api` only returns endpoint discovery metadata.

| Method and path | Auth | Current behavior |
|---|---|---|
| `GET /health` | None | Liveness, server time, Sabre-configured boolean |
| `POST /auth/signup` | None | Creates Mongo user, returns JWT and public user |
| `POST /auth/login` | None | Verifies password, returns JWT and public user |
| `GET /auth/me` | Required | Restores the current user from JWT |
| `GET /search/flights` | Optional | Duffel/Sabre normalized offers; invalid/missing airports or date return 400; logs signed-in search |
| `GET /search/hotels` | Optional | Five deterministic mock listings; logs signed-in search |
| `GET /search/cabs` | Optional | Four deterministic mock listings; logs signed-in search |
| `POST /bookings/quote` | Required | Refreshes Duffel offer and saves versioned quote from `{ offerId }` |
| `POST /bookings` | Required | Sandbox checkout from `{ quoteId, version, passenger }`; requires `Idempotency-Key: <quoteId>` |
| `GET /trips` | Required | Own saved bookings, newest first; excludes unsubmitted quotes and definitive failures |
| `GET /trips/:id` | Required | Own trip; reconciles pending/ambiguous order outcomes |
| `GET /trips/:id/tracking` | Required | Reads own Duffel order and airline-initiated changes; no mock fallback |
| `GET /tracking/:flightNumber` | None | Default 501 `SAVED_TRIP_REQUIRED`; explicit Sabre mode attempts status and returns 503 if unavailable |
| `GET /history` | Required | Current user's searches, newest first |
| `POST /simulator/demo/seed` | None | Seeds `demo-trip` fixture |
| `POST /simulator/trips/:tripId/seed` | None | Seeds custom `{ nodes: [...] }` |
| `POST /simulator/trips/:tripId/nodes/:nodeId/cancel` | None | Sets node status to `CANCELLED` |
| `POST /simulator/trips/:tripId/flights/:flightId/delay` | None | Sets delay and projected arrival from `{ minutes }` |
| `POST /simulator/bookings/fail-next` | None | Arms one new booking failure through either active adapter; cached retries do not consume it |
| `GET /simulator/member-bookings?airline=ZZ&flightNumber=ZZ123` | None | Lists confirmed sandbox member bookings for an exact flight |
| `POST /simulator/member-bookings/disrupt` | None | Simulates cancellation or delay for every confirmed matching passenger |
| `POST /simulator/member-bookings/recover` | None | Runs safe recovery independently for affected member trips and updates saved trips after confirmation |
| `GET /simulator/trips/:tripId/analyse` | None | Returns Watcher events and impact arrays |
| `POST /simulator/trips/:tripId/recover` | None | Runs the whole loop: detect, assess, search real alternatives, score, apply policy, book safely; returns ranked options, the decision, execution attempts, the audit trail, plus `recoveryId` and `auditPersisted` |
| `GET /simulator/trips/:tripId/audit` | None | The durable audit trail for one trip, newest first |
| `GET /simulator/audit` | None | Recent audit entries across all trips (`?limit=`) |
| `GET /simulator/state` | None | Returns current in-memory trips and bookings |

Missing simulator trips/nodes return 404. Invalid delay/node payloads return
400. Audit reads remain independent of in-memory trip existence so historical
audits are still readable after restart.

Search query names are case-sensitive as currently implemented:

- Flights: `origin`, `destination`, `departuredate`.
- Hotels: `destination`, `checkIn`, `checkOut`.
- Cabs: `destination`.

Flight airport codes must be distinct uppercase three-letter strings; dates
must be valid YYYY-MM-DD dates. Hotels require checkout after check-in. Missing
or malformed fields return 400 before any travel-provider calls.

Search endpoints remain browseable without an account. A valid bearer token
adds history logging; an invalid token is ignored by optional auth. History, checkout, saved trips, tracking, and
the authenticated mobile tabs require a valid bearer token.

## Member checkout constraints

- `src/routes/bookings.js` calls `src/bookings/service.js`, which receives the
  provider port and Mongo store. All trip reads and updates include the JWT
  owner's ID. Passenger IDs, payment amounts and currency come from Duffel's
  server-side quote, never client-provided fare fields.
- One-way, one adult aged 18+, with validated contact and required passport
  details. The screen offers a test passenger preset. No live-token override,
  card collection, automatic alternative purchase, or member cancellation API.
- A unique `{userId, offerId}` index and atomic `QUOTED -> BOOKING` claim prevent
  duplicate order POSTs for the same quote across workers/restarts. The quote's
  UUID is the required idempotency key and Duffel metadata reference.
- A changed price, currency, itinerary or document requirement returns 409
  `QUOTE_CHANGED` with a new version. The member must review and confirm again.
  Preflight failures can safely return to `QUOTED` before any order POST.
- Order creation is independently checked using GET order before reporting
  `CONFIRMED` (booking reference and payment no longer awaiting payment).
  `BOOKING`, `PENDING`, and `REVIEW_REQUIRED` are visible pending states; a
  timeout is never permission for a second POST or a different-flight purchase.
- If the response was lost, reconciliation searches orders for the offer and
  matches the server-generated metadata. An unresolved outcome stays pending
  for review, including a crash after claim but before POST. It has no automatic
  retry lease. Definitive rejections become `FAILED`; cancellations `CANCELLED`.
- Tracking reads `/air/orders/{id}` and `/air/airline_initiated_changes?order_id=`.
  It returns booking status, checked/synced timestamps and previous/new schedules;
  reading does not accept a change or trigger recovery. It does not establish
  boarding, landed or on-time status. A general flight-number feed remains absent.
- Recovery now has its own refreshed-offer and confirmation checks, but its
  pending state remains process-local. Member checkout's Mongo claims do not
  provide durable idempotency to the separate recovery executor.

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
- `memberTrips`: UUID `id`, JWT `userId`, `offerId`, quote/version, status,
  passenger/fingerprint, order ID/reference, total and embedded booking audit.
  Unique indexes on `id` and `{userId, offerId}`; user/time index. Requests persist
  before vendor mutation; failure to persist prevents checkout. Public responses
  omit contact/passport details and internal passenger identifiers.
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

- Auth uses **double Base64**: encode client ID and secret separately, join with
  `:`, then encode the result. Cached tokens refresh with a 60-second skew.
  `invalid_client` usually requires checking/rotating CERT credentials, not
  changing the encoding. Never expose credential values in diagnostics.
- This trial account supports InstaFlights `GET /v1/shop/flights` and
  `GET /v2/shop/flights`. A JSON `No results were found` 404 means empty results.
  Coverage is limited; Duffel is the default for broader route coverage.
- `GET /v2/shop/flights` is InstaFlights v2. Bargain Finder Max is **POST** at
  that path and is not provisioned. Method and response shape both matter.
- Lead Price Calendar, Fare Range, Low Fare History/Forecast, Multi-Airport City,
  airline/aircraft lookup and city pairs are included in `scripts/probe-sabre.js`.
  Fare Range is `/v1/historical/flights/fares`; `/v1/shop/flights/fares` is
  Lead Price Calendar v1. Check `FareData` versus `FareInfo` markers.
- Flight Status/FLIFO, schedules, PNR creation, seat maps, alternate dates and
  revalidation are not provisioned on this trial account. Get Booking can return
  HTTP 200 with embedded `UNAUTHORIZED_ACCESS`; 200 alone is not success.
- Missing mandatory parameters are reported one at a time. Provisioning and
  response-marker classification live in `src/sabre/probe.js` and probeCatalog.
  Re-probe the account before changing endpoints or assuming new access.
- Explicit `STATUS_PROVIDER=sabre` can attempt the legacy flight-number route.
  Missing status returns 503; member tracking never substitutes mock status.

## Provider selection

| Env var | Default | Alternatives |
|---|---|---|
| `SEARCH_PROVIDER` | `duffel` | `sabre` |
| `BOOKING_PROVIDER` | `duffel` | `simulator` |
| `STATUS_PROVIDER` | `duffel` | `sabre` for legacy flight-number lookup only |
| `POLICY_COST_CAP_CURRENCY` | `EUR` | must match what the search provider quotes |

`src/providers/search.js` is the single search entry point: it picks the
provider, normalizes, and applies the plausibility filter, so the mobile route
and the recovery loop cannot tell the providers apart.

`BOOKING_PROVIDER=duffel` requires `SEARCH_PROVIDER=duffel` - a Duffel order
needs a Duffel offer id. `providerMismatch()` warns at startup.

**Currency matters.** Duffel test mode quotes EUR while Sabre CERT quotes USD.
The policy engine refuses to compare across currencies rather than inventing a
rate, so `POLICY_COST_CAP_CURRENCY` and the trip fixture must match the active
provider or every recovery escalates on `COST_CAP`.

## Duffel-specific facts

- Search uses `POST /air/offer_requests?return_offers=true`; quote refresh uses
  `GET /air/offers/{id}`; booking uses `POST /air/orders`; independent lookup uses
  `GET /air/orders/{id}`. Cancellation creates an order cancellation then confirms
  it through `/actions/confirm`. See `src/duffel/client.js`.
- **Do not assume Duffel's `Idempotency-Key` deduplicates POST orders.** A repeated
  booking can return `422 offer_request_already_booked`. Recovery's adapter owns
  a process-local cache of in-flight, completed and ambiguous results; member
  checkout owns a durable Mongo claim.
  Do not remove either based on the vendor header.
- An offer request can be booked once; offers expire within minutes. Partner
  offers can be bookable in test mode, though some expire/fail at checkout.
  Recovery's candidate fallback does not apply to ambiguous member purchases.
- Test seat maps exist for Duffel Airways (`ZZ`). Partner offers may return an
  empty map without an error. Seat selection is not connected to mobile checkout.
- Test quotes commonly use EUR. Keep exact quoted amount/currency; do not assume
  a currency or compare recovery policy caps across currencies.
- The legacy client requires `duffel_test_` unless explicitly overridden with
  `DUFFEL_ALLOW_LIVE=yes-i-understand`. **Member checkout always requires a test
  token and `live_mode === false`, regardless of that override.**
- Saved order and airline-initiated-change tracking is documented in
  [Duffel's change API](https://duffel.com/docs/api/airline-initiated-changes/schema).
  It is separate from a general operational flight-status feed.

Exercise the provider adapter with `npm run demo:duffel`, or the recovery loop with
`npm run smoke:recovery` (creates and cleans up its own test order/audit).
Exercise authenticated member checkout/trips/tracking with `npm run smoke:member` against a temporary
backend (see README.md). External checks create and cancel sandbox orders;
keep them separate from the automated suite.

## Mobile app behavior

Navigation has four bottom tabs:

- **Home:** public search entry and recent signed-in searches. History's API
  remains for this feature; there is no History tab.
- **Trips:** auth-gated Protected Trips from Mongo, refreshed on focus and pull.
  Details show itinerary, passenger name, actual fare and booking reference.
- **Track:** auth-gated saved-flight selector, reads Duffel when focused or
  selected and on manual refresh. Shows booking status and schedule changes.
- **You:** auth-gated account, local autonomy limits, notification toggles, logout.

Nested route names are distinct from their parent tabs: `ProtectedTrips`,
`FlightTracking`, `Profile`; Home's parent is `HomeTab`. The Home stack includes
Search, Results, Item Details, Booking, and checkout Login/Signup. Signing in
from checkout returns to the selected offer. Results use
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

## Verification commands

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

Exercise the Option Engine end to end against live Sabre data:

```powershell
npm run demo:rebook
```

It searches, drops implausible itineraries, treats the earliest nonstop as
cancelled, and prints the ranked replacements with a per-factor breakdown.

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
9. Arm **Force next booking failure** before recovery to demonstrate fallback
   while retaining the old ticket, with either Duffel or the simulator adapter.
10. After recovery, verify the flight card shows `CONFIRMED` and its new
    schedule; `/simulator/state` contains the replacement booking id. Running
    recovery again does not buy another ticket for that repaired flight;
    connection-risk events may still be reported.

The demo searches alternatives, scores them, applies policy, creates a sandbox
replacement, releases the old demo booking, and persists an audit trail in
MongoDB on a best-effort basis. It composes a message but does not deliver it.

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
- Do not infer durable recovery or automatic member monitoring from the tested
  simulator flow. Pending recovery state remains process-local; persisted member
  trips are not yet connected. See outstanding work in SESSION_STATUS.md.
- Do not call a build/test pass proof of working Sabre credentials or Mongo.
- Do not change Sabre endpoints based only on generic provider docs; confirm
  which products this exact trial account has provisioned.
- Do not run Expo tooling from the backend root.
- Keep Expo SDK 57 unless the test phone's Expo Go version and the versioned
  migration instructions have been verified.
- Preserve user changes in a dirty working tree. Inspect `git status` and the
  relevant diff before editing.

## Recommended next implementation order

Follow the checkboxes and session plan in [SESSION_STATUS.md](./SESSION_STATUS.md).
Phases 4–6, durable audit storage, authenticated member sandbox checkout,
persisted trips, and connected mobile booking/tracking already exist. Review
phone/UI feedback, then add durable recovery claims and integrate saved policy
and member trips with recovery. Production services and additional
orchestration remain deferred.

## How to work efficiently in future chats

- Start with this file's opening instructions, SESSION_STATUS.md, and `git status`.
- Follow the existing code conventions and safety rules; keep changes focused
  on the active task and preserve unrelated working-tree changes.
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

### Maintaining the handoff

- Update SESSION_STATUS.md after meaningful work or a change of direction, and
  before handing the task back when project state has changed. Do this as part
  of the work, without waiting for a separate reminder.
- Keep it a concise current snapshot: completed work, dated verification and
  failures, unresolved issues, decisions, and the exact next task. Distinguish
  source review, automated checks, and actual device/provider verification.
- Replace stale statements and update TODO checkboxes rather than appending a
  transcript or duplicating old status. Mark work complete only when verified.
- Keep durable project conventions in AGENTS.md, operator setup in README.md,
  and product vision in CLAUDE.md. Link between files instead of repeating them.
- Keep dated test results, verification history, and running/stopped service
  state in SESSION_STATUS.md. AGENTS.md holds the checks to run and lasting
  implementation constraints; do not append session verification logs here.
- Do not create PROJECT_CONTEXT.md or another competing handoff file. Keep
  secrets and raw credentials out of all context files.
