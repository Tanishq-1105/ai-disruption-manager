# TripShield — session handoff and TODOs

Updated: 2026-10-04. Read after AGENTS.md, then inspect relevant source only.
Source/package files are authoritative. Preserve the dirty working tree; no
commits were created. Maintain this snapshot without reminders; dated results
belong here, conventions in AGENTS.md, setup in README.md. No PROJECT_CONTEXT.md.

## Where we stopped

Current branch is `main`, tracking `origin/main`. The pre-existing recovery
changes were restored from the retained main-branch stash; the airport-
autocomplete feature branch was not merged. The working tree is intentionally
dirty and uncommitted. A separate feature-branch safety stash is also retained.

Persisted-member recovery now uses Mongo-backed attempts, exclusive leases,
ordered checkpoints, saved-order reconciliation and compare-and-set trip
updates. Recovery does not issue a second order POST after an uncertain
outcome. Exact policy escalations can pause for durable owner-scoped approval
in the authenticated member app, bound to the unexpired prepared quote and
policy fingerprint. Trip Details now shows the durable redacted event timeline.
The recovery status endpoint returns `recovery: null` for an owned trip before
any disruption (while preserving 404s for unowned/missing trips), allowing
Trip Details to load before simulation. The in-memory simulator graph and
Duffel adapter cache remain process-local. Actual phone interaction and live
sandbox validation remain pending. No live Duffel booking was used.

The localhost Member bookings panel now exposes an explicit testing-only
approval button when a saved trip is awaiting approval. It submits the stored
fingerprint for that one member trip and is restricted to loopback requests
outside production; Mongo records the actor as `LOCAL_BACKEND_TESTER`, distinct
from member consent.

On 2026-09-22, added the first bridge from persisted member bookings to the
disruption simulator. An authenticated owner can manually simulate a
cancellation or positive delay on a confirmed Duffel sandbox trip. The saved
trip remains unchanged; the simulator graph retains the original Duffel order
id for the next recovery phase.

The same workflow is available from the localhost control panel for a whole
flight cohort: search confirmed sandbox bookings by exact airline/flight
number, simulate cancellation/delay for every matching passenger, then recover
each passenger independently. As of 2026-09-29, the Cancel and Recover controls
are wired to these localhost APIs; recovery returns and renders the updated
Duffel sandbox order ID/reference/itinerary/fare. Recovery sends the saved
passenger and `tripshield_booking_id` metadata into the replacement order so
the saved trip's Track view can verify that new order. The saved Mongo trip
changes only after confirmed recovery and uses a compare-and-set on its old
order ID.

The localhost admin panel now loads all saved Duffel sandbox trips with order
IDs from MongoDB on page load, groups them by airline and flight number, and
refreshes the current view every 30 seconds or on **All trips / reload**.
Database reads use a loopback-only cursor-paged endpoint; flight-specific
search remains available. Grouped trips retain confirmed-flight cohort actions,
and every confirmed booking can expose the local synthetic-recovery test.

The backend now polls confirmed Duffel sandbox member orders every five minutes
by default. A Duffel-reported cancellation starts the existing durable recovery
and policy flow automatically; escalation still waits for explicit approval.
This is order-cancellation monitoring only, not a general flight-status feed,
and schedule/delay changes are not automatically acted upon. Duffel order
status does not attribute who initiated a cancellation, so automatic purchase
on this signal is appropriate only for the sandbox rehearsal. Live booking
remains rejected by the test-token guard.

For deterministic rehearsal, loopback-only
`POST /simulator/member-bookings/test-disruption` creates a durable synthetic
cancellation for one confirmed sandbox trip and runs the same recovery flow
without cancelling the Duffel order first. The synthetic attempt is resumed by
the poller after a restart if needed. An automatic policy decision may create a
Duffel test order; use only a test token and a disposable sandbox trip.

## Completed this session

- 2026-10-04: switched back to `main` and restored the uncommitted recovery
  work without discarding it. Added backend-startup polling of confirmed
  Duffel sandbox orders (5-minute default, batches of 100). A provider-reported
  cancellation starts or resumes the durable recovery flow; terminal and
  approval-waiting attempts are not repeated, while unresolved attempts resume
  through the existing read-only reconciliation safeguards. Polling is disabled
  for live Duffel tokens or non-Duffel booking and can be explicitly disabled
  with `MEMBER_RECOVERY_POLLING=false`.
- The poller detects only a cancelled Duffel order; it does not monitor generic
  flight status, delay, or schedule changes. Duffel does not attribute who
  initiated cancellation, so this automatic purchase path is sandbox-rehearsal
  only. No backend was started and no sandbox order was created in this work.
- Added loopback-only `POST /simulator/member-bookings/test-disruption` to
  create and process a durable synthetic cancellation for one confirmed saved
  sandbox trip. It is disabled in production, requires polling enabled and a
  Duffel test token, and resumes pending test attempts after restart. The
  localhost Member bookings panel shows a per-passenger **Test automatic
  recovery** button only when the backend reports that local test mode is
  enabled. This route can cause a sandbox replacement order if policy permits.
- 2026-10-04 full backend suite after the local test route: **319 passed, 0
  failed** (serial run). Targeted monitor/member-booking/recovery-store tests,
  `git diff --check`, and editor diagnostics passed. Tests stub provider calls;
  they do not verify a live Duffel change or order.
- 2026-10-05 admin trip listing: cursor paging, saved-trip listing, and invalid
  cursor/limit validation verified; **320 backend tests passed, 0 failed**.
  `node --check public/app.js`, `git diff --check`, and editor diagnostics
  passed. A live browser UI check remains pending.
- Added the per-trip **Test automatic recovery** button to the localhost Member
  bookings panel. The list endpoint exposes it only for loopback requests when
  local test mode is enabled; the click warns that a sandbox replacement order
  may be created. Targeted UI-route/poller tests: **14 passed, 0 failed**;
  `node --check public/app.js`, editor diagnostics and `git diff --check`
  passed. No browser click or sandbox order was performed.
- Added an explicit Duffel Airways-only deployment mode. Duffel search and both
  recovery/member quote refreshes now accept only carrier `ZZ` by default;
  `DUFFEL_AIRWAYS_ONLY=false` can disable the carrier filter without changing
  the sandbox guard.
- Confirmed this mode is compatible with a production runtime: a deployment
  may use `NODE_ENV=production` while still using a `duffel_test_` token. Live
  tokens remain rejected by the client/member booking guards.
- 2026-09-22 backend suite after the provider change: **277 passed, 0 failed**.
- 2026-09-22 targeted member-booking suite after the disruption simulator:
  **18 passed, 0 failed**.
- Added `POST /trips/:id/simulate-disruption`, owner-scoped and sandbox-only,
  supporting `CANCELLED` and positive `DELAYED` simulations.
- Added operator dashboard endpoints `GET /simulator/member-bookings`,
  `POST /simulator/member-bookings/disrupt`, and
  `POST /simulator/member-bookings/recover`. The dashboard now finds exact
  flight cohorts, affects all confirmed matching sandbox bookings, and can
  recover the affected passengers.
- 2026-09-22 full backend suite after cohort simulation/recovery changes:
  **279 passed, 0 failed**.
- Fixed the member panel button handlers: they were nested inside the delay
  handler and listened on the wrong panel, so browser clicks could not invoke
  them. The buttons now call the cohort cancellation/recovery routes.
- Recovery now uses the original saved passenger for member replacements,
  retains member-trip ownership metadata for Track verification, and fails
  pre-booking when the replacement requires missing identity documents.
- Recovery response now includes confirmed replacement reference and fare;
  both the member cohort results and the seeded-demo trip card show sandbox
  order details. Saved member updates use an expected-original-order CAS.
- 2026-09-29 full backend suite: **280 passed, 0 failed**. Syntax checks and
  `git diff --check` passed. No live Duffel order was created in this session.
- Added Mongo-backed `recoveryAttempts` with a unique disruption identity,
  exclusive renewable lease, lease-checked checkpoint writes, ordered events,
  and saved original-flight/disruption data.
- Persist the exact authorized offer, policy/decision snapshot, passenger
  ownership metadata, and stable idempotency key before the order POST.
  Post-request resumes reconcile with Duffel reads only; they never submit a
  second POST for an uncertain attempt.
- Persist and resume replacement confirmation, original-order release, and
  member-trip update checkpoints. The saved-trip update remains compare-and-set
  against the original order and revision; duplicate cohort disruption events
  reuse the same durable attempt.
- If original cancellation throws, perform a read-only order lookup before
  deciding it failed; never retry cancellation blindly. Provider search errors
  are surfaced as retryable processing failures instead of being misreported
  as “no safe option.”
- 2026-09-29 full backend suite after durable-state changes: **285 passed,
  0 failed**. Focused recovery tests: **32 passed, 0 failed**. Syntax checks,
  editor Problems, and `git diff --check` passed. No live Duffel order created.
- Added durable approval/rejection transitions with owner and fingerprint
  compare-and-set checks, quote expiry validation, and ordered member-decision
  events. Authenticated Trip Details now displays the replacement itinerary,
  exact fare, policy reasons and expiry, with explicit approve/reject controls.
  Approval authorizes only the prepared quote; any expiry or policy/term drift
  requires another confirmation. Simulator disruption remains explicitly
  separate from cancelling the original Duffel order.
- 2026-09-29 policy/approval verification: **299 backend tests passed, 0
  failed** (serial run), including owner/fingerprint/expiry approval-store
  tests and stale-approval rejection; focused policy/executor/recovery tests:
  **143 passed, 0 failed**.
  Expo SDK 57 Android export succeeded. No live Duffel booking was created.
  Phone interaction and route-level crash injection are not yet verified.
- Added a local control-panel approval button for persisted member recovery
  escalations. Cohort recovery now prepares and persists the exact approved quote;
  the local action is loopback-only, disabled in production, and audited under
  `LOCAL_BACKEND_TESTER`, not as member consent.
- 2026-09-30 local approval verification: **307 backend tests passed, 0 failed**.
  Focused approval/recovery tests cover stale fingerprints, expiry, local-only
  access, actor audit identity, and sandbox order recovery. `node --check` for
  the control-panel JS and `git diff --check` passed. The panel still requires
  a browser rehearsal; no test order was created.
- Added the mobile recovery timeline from redacted Mongo checkpoints and fixed
  the no-disruption recovery read so owned trips return `recovery: null` rather
  than an error. Added HTTP route ownership/stale-approval checks and crash
  recovery tests for uncertain order POSTs and an audit-write outage after
  release; both resume read-only without another POST.
- 2026-09-30 full backend suite: **304 passed, 0 failed** (serial run).
  Focused saved-member recovery/store/routes: **30 passed, 0 failed**.
  Expo SDK 57 Android export and `git diff --check` passed. No live sandbox
  order created. Tests cover lost POST response, audit-write failure after
  release, no-repeat read-only reconciliation, member-trip CAS conflict, and
  route auth/ownership/stale approval. Physical-device rehearsal remains
  outstanding.

- Recovery obtains a prepared quote through the provider port, rechecks current
  fare/currency, arrival/cabin policy and viability, then uses that exact quote
  for the order POST. No unchecked price refresh occurs inside booking.
- Independent lookup must confirm the correct order, paid state, exact fare and
  itinerary before the original ticket is released. A creation response alone
  is insufficient. Audit records refreshed approval → request → independent
  confirmation → release → trip update → dependent actions.
- Pending orders, failed lookups, order mismatches and ambiguous POST responses
  return REVIEW_REQUIRED. The original ticket and dependents remain unchanged;
  fallback is allowed only after a definite NOT_CREATED rejection.
- Repeat recovery checks the existing attempt, without another search/purchase.
  Lost Duffel responses can reconcile through server-generated order metadata.
  Concurrent direct adapter retries share one POST. The completed attempt is
  cleared after the replacement is saved, allowing a later disruption to start
  a new recovery. A failed graph update can reuse the confirmed purchase.
- Hotel/ride changes are SKIPPED unless flight recovery succeeds. Failed
  dependent changes are disclosed in the member message as open items.
- Invalid/missing search fields now return 400 before provider calls. Missing
  simulator trips/nodes return 404; invalid delay/seed payloads return 400.
- Added `npm run smoke:recovery`: live provider-port recovery and Mongo audit
  verification, with its own test-order cancellation and temporary audit cleanup.

## Current app and environment

- Previous session delivered four tabs: Home, Trips, Track, You; removed History
  and duplicate nested names. Recent searches remain on Home.
- Signed-in Duffel sandbox checkout supports one adult with a test passenger
  preset. Confirmed orders automatically persist in Mongo Protected Trips.
  Owner-scoped reads and durable member request claims survive restarts.
- Track calls Duffel order and airline-initiated-change APIs for saved flights.
  It does not report general flight-number/boarding/landing status, accept
  changes, or trigger recovery. No sample-status fallback remains.
- Ubuntu, Node 24.20.0; dependencies installed. Expo 57.0.22, React Native 0.86.3,
  React 19.2.3 match the phone's Expo Go. Root/mobile `.env` files exist; hosted
  Mongo works, so local Mongo is unnecessary. Never print/commit credentials.
- Search/booking/status default to Duffel test mode. Sandbox reservations have
  no real charge or usable ticket. Hotels/cabs remain search demos; notification
  messages are composed but not delivered. Member preferences remain local.

## Verification

- 2026-09-13 final full backend suite: **277 passed, 0 failed**, including Mongo.
  Added 35 tests since the member session's 242. Coverage includes refreshed
  prices/currencies, readiness, independent confirmation, pending/unpaid/mismatched
  orders, lost responses, concurrent/repeated calls, later disruptions, graph
  update retry, dependent gating/messages and HTTP validation. Travel APIs are
  stubbed in the automated suite.
- 2026-09-13 live `npm run smoke:recovery`: **13 passed, 0 failed**. Real Duffel
  Airways sandbox search/order lookup, confirm-before-release, actual fare in
  graph/message, dependent ordering, repeat protection and persisted audit passed.
  The test order was cancelled and verified cancelled; its temporary audit was
  removed. This uses real providers plus the orchestrator, not the HTTP recovery
  route. Fault cases are covered by automated tests.
- Previous member session: **21/21 live API checks**, including sandbox checkout,
  saved trips, ownership, retries, tracking and Mongo persistence. Its test order
  was cancelled and its own account/history/member records removed.
- Previous SDK 57 Android production/Hermes export passed; final screen-copy
  changes passed JSX parsing. Earlier Expo Doctor: 21/21. **Phone interaction
  remains unverified; no new mobile build was needed for this backend session.**
- Live member tracking returned a confirmed order and an empty changes list.
  Schedule-change cases use fixtures. AeroDataBox probe on 2026-09-13 returned
  403 “You are not subscribed to this API”; general live status remains unavailable.

## Remaining work and next session

1. After configuring the backend with Duffel test credentials, verify the
   poller's read-only order checks, then rehearse phone search → sandbox book →
   saved trip → recovery approval/rejection → updated trip/history. A detected
   cancellation may automatically create a sandbox replacement when policy
   authorizes it; never use live ticketing.
2. Extend injected crash coverage to every provider/checkpoint boundary,
   especially confirmed-order lookup, old-order cancellation reconciliation,
   and the member-trip compare-and-set. Simulator graphs and adapter in-flight
   caches remain process-local.
3. Persist member policy/preferences and apply those saved choices to recovery.
4. General live flight-status monitoring, delay/connection-risk polling, and
   notification delivery remain separate milestones.

### Recovery state machine (2026-09-29)

Persisted-member recovery is a durable state machine per member trip and
original order, not a process-local simulator cache. The initial automatic
scope remains a confirmed cancellation; delay/connection-risk cases need
itinerary-wide feasibility and safe timing rules before automatic action.

Current attempt identity and checkpoints:

- Unique recovery key includes `memberTripId`, `originalOrderId`, disruption
  type/delay, flight number, and scheduled itinerary times; duplicate requests
  reuse the attempt while a later event on a replacement order can create one.
- Atomically claim with Mongo compare-and-set and a short lease. A lease expiry
  permits safe takeover; expired owners cannot checkpoint, and post-request
  takeover is reconciliation only, never permission to repeat a Duffel POST.
- Persist the original flight/disruption snapshot and member-trip revision;
  persist the exact refreshed offer, policy/decision snapshot and stable
  idempotency key before submitting the new order.
- Persist the exact refreshed offer, evaluated terms, candidate authorization,
  and stable idempotency key before submitting the new order. The audit
  collection remains best-effort; durable recovery events/checkpoints are the
  source for restart reconciliation.
- The authenticated recovery read includes a safe allowlist of ordered event
  fields. It omits idempotency keys and passenger data; an owned trip with no
  disruption returns a null recovery rather than an error.

Required state progression:

`DISRUPTION_SIMULATED -> CLAIMED -> ASSESSING -> AUTHORIZED ->`
`BOOKING_REQUESTED -> ORDER_CREATED -> NEW_CONFIRMED -> OLD_RELEASE_PENDING ->`
`COMPLETED | COMPLETED_NEEDS_ATTENTION`

Terminal or blocking states include `NO_SAFE_OPTION`, `REVIEW_REQUIRED`,
`REJECTED`, and `FAILED`. Any timeout, ambiguous POST, failed independent read,
order/metadata mismatch, or exact fare/itinerary mismatch enters
`REVIEW_REQUIRED`; reconciliation is read-only until the provider proves the
existing result. Only explicit `NOT_CREATED` permits another candidate.

Non-negotiable recovery invariants:

- Independently confirm the exact new Duffel order, sandbox mode, paid/confirmed
  state, passenger/trip metadata, itinerary, cabin, fare, and currency before
  attempting to cancel the original order.
- If original cancellation is uncertain/fails, retain the new confirmed order,
  do not buy again, record both orders, and surface `COMPLETED_NEEDS_ATTENTION`.
- Update the member trip with a compare-and-set against its original order ID
  and revision. On a conflict or crash, reconcile the durable attempt; never
  overwrite a newer booking.
- Authorize each exact candidate against the persisted policy. Unknown cabin,
  timezone/date, currency, refundability, or missing schedule data fails closed.
  Approval is bound to candidate, quote version/expiry, fare, currency,
  itinerary, and policy version; changed terms invalidate approval.
- Keep dependent hotel/ground actions behind confirmed flight recovery and
  separately checkpoint/audit each action.
- Cohort simulation may process passengers independently, but production-facing
  recovery endpoints need operator/member authorization and bounded batch work.

Test the state machine with concurrent requests and injected crashes after each
external side effect. In particular: crash after order POST (reconcile without
another POST), after new confirmation (resume old release), after old release
(resume member-trip update), and during audit/checkpoint persistence. Also test
lease takeover, stale member-trip revision, duplicate disruption delivery,
unknown booking outcomes, policy changes before approval, changed refreshed
quote, partial cohort failure, and one member's failure not blocking others.

Simulator recovery remains process-local. A saved-member attempt claimed before
an order POST may safely resume search; once `BOOKING_REQUESTED` is persisted,
the order outcome is reconciled read-only. An unresolved lookup remains
`REVIEW_REQUIRED` and cannot trigger another POST. Audit collection writes are
best-effort, while recovery checkpoints are durable and required before
side-effects.

Next: end-to-end device rehearsal and more provider/checkpoint fault injection.
Defer live ticketing/payments, extra
orchestration, deployment, seat selection and message-delivery channels until
the sandbox flow is reliable.

## Resume commands and source map

From `~/Projects/ai-disruption-manager`, in separate terminals:

```bash
npm run dev                 # backend/control panel, port 4001
npm run mobile              # Expo, port 8081; prints the phone QR code
```

Phone: Home → Flights → future-date search → select → sign in → Use test
passenger → confirm → Protected Trips → Track. Last LAN: `192.168.31.145`;
mobile API/Metro settings match it. After changing networks, use `hostname -I`
and update those local settings together.

Checks: root `npm test` (isolated `travel_disruption_concierge_test` database),
`npm run smoke:recovery` (no dev server), or temporary `PORT=4002 npm start` then
`npm run smoke:member` in another terminal. Stop that temporary backend afterward.
See README.md. Store tests delete isolated test records; never use member data.

- Recovery: `src/agent/executor.js`, `recovery.js`, `policy.js`, `notifier.js`;
  `src/duffel/adapter.js`, `src/providers/index.js`, `src/simulator/state.js`.
- HTTP: `src/routes/search.js`, `src/errors.js`, `src/middleware/errorHandler.js`.
- Tests: `test/agent.executor.test.js`, `agent.recovery.test.js`,
  `agent.notifier.test.js`, `routes.validation.test.js`; `scripts/smoke-recovery.js`.
- Member flow: `src/bookings/service.js`, `src/store/memberTrips.js`,
  `src/routes/bookings.js`, `src/duffel/member.js`, `mobile/src/screens/`.

Preserve deterministic decisions, provider boundaries, explicit spending limits,
sandbox guards, confirm-before-release ordering and audit evidence.
