# TripShield — session handoff and TODOs

Updated: 2026-09-22. Read after AGENTS.md, then inspect relevant source only.
Source/package files are authoritative. Preserve the dirty working tree; no
commits were created. Maintain this snapshot without reminders; dated results
belong here, conventions in AGENTS.md, setup in README.md. No PROJECT_CONTEXT.md.

## Where we stopped

Completed the next backend session: recovery now checks refreshed offers and
independently confirms orders before release, pauses uncertain purchases, and
gates dependent changes. Phone/UI feedback is still pending. No mobile code was
changed in this session. The user starts backend/Expo in their own terminals to
see the QR code; development servers were not needed for these checks.

On 2026-09-22, added the first bridge from persisted member bookings to the
disruption simulator. An authenticated owner can manually simulate a
cancellation or positive delay on a confirmed Duffel sandbox trip. The saved
trip remains unchanged; the simulator graph retains the original Duffel order
id for the next recovery phase.

The same workflow is now available from the localhost control panel for a
whole flight cohort: search confirmed sandbox bookings by exact airline and
flight number, simulate cancellation/delay for every matching passenger, then
run the existing safe recovery independently per passenger. A saved member trip
is updated only after the replacement is independently confirmed.

## Completed this session

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

1. Add durable recovery claims, audit/checkpoint recovery and restart
   reconciliation for member recovery. Current simulator graphs, pending
   recovery attempts and adapter caches are process-local.
   Never restart/reseed to clear an uncertain purchase; reconcile it first.
3. Finish policy edge cases before automatic member recovery: source review
   found same-day checks slice dates while original graph timestamps are UTC and
   Duffel schedules are local; normalize destination-local dates near midnight.
   Flight refund conditions and unknown cabins also need explicit fail-closed
   rules. The refreshed checks currently enforce the existing policy rules.
4. Persist the member's policy/preferences and connect owned saved trips to
   recovery. Show replacement, cost, audit and approval items in Trips.
5. Rehearse phone search → sandbox book → saved trip → injected disruption →
   recovery → updated trip/message. Live monitoring remains a separate milestone.

Member checkout's durable Mongo claims do not make simulator recovery durable.
The recovery audit is still best-effort at the end of a request; a crash or graph
update exception can interrupt persistence. A member request claimed before a
crash but never posted can remain pending for manual review; no retry lease exists.

Remaining work sessions this week: policy edge cases and durable recovery;
member preferences/trip integration; recovery results/approvals; end-to-end
rehearsal. Defer live ticketing/payments, extra orchestration, deployment, seat
selection and message-delivery channels until the sandbox flow is reliable.

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
