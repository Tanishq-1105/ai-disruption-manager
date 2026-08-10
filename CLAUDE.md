# CLAUDE.md — Project Context

> This file gives an AI coding assistant (e.g. Claude in VS Code) the context it
> needs to work on this project. Read it before making changes.

## What this project is

**Autonomous Travel-Disruption Concierge** — an agent for a card company (American
Express hackathon) that automatically resolves flight disruptions. When a card
member's flight is cancelled or a connection becomes impossible, the agent
detects it within seconds, finds a replacement flight, rebooks it, adjusts the
hotel and ground transport, and sends the member one clear message. The member
does nothing in the common case.

It goes beyond apps that only *announce* a disruption — it *acts* in real time.

**One-line goal:** the member wakes up already rebooked.

## Core architecture (read this first)

The system splits into two halves behind a single swappable interface
(Ports & Adapters / Hexagonal architecture):

- **Search / information (real):** flight and hotel data comes live from the
  **Sabre APIs**. This is the "looking" half.
- **Actions (simulated):** the cancellation, seat scarcity, booking, and failures
  come from a **self-built simulator** we control. This is the "doing" half,
  because no airline gives sandbox access to reissue real tickets.

Both sit behind one provider interface (the "socket"). Going to production =
swap the simulator adapter for a real ticketing adapter. **The agent core never
changes.** When writing code, always route external calls through the provider
interface — never let the agent core call Sabre or the simulator directly.

> Note: Sabre is the chosen travel-data provider. Amadeus is a drop-in
> alternative behind the same interface if Sabre access is a blocker.

## The agent's four steps (the core loop)

1. **Notice** — detect a cancellation, or a connection that has become impossible
   (compare projected arrival of one leg against the next leg's departure; can
   fire while the traveller is still airborne).
2. **Assess** — walk the trip's dependency graph and find everything else that
   breaks (hotel, car, meeting).
3. **Pick** — search real alternatives (Sabre), filter impossible ones, score the
   rest on arrival time, cabin, stops, cost, airline; choose the best.
4. **Book safely** — book the new ticket, then release the old one.

## Non-negotiable safety rule

**Never release the old ticket until the new one is confirmed.** This build books
directly (no seat "hold" step), so this ordering is the ONLY thing preventing a
member being left with no ticket. If a booking fails, keep the old ticket and try
the next option. Do not reorder these steps.

Also: every booking request carries a unique idempotency key so a network retry
cannot cause a double booking / double charge.

## Bounded autonomy (the trust rule)

The agent acts alone on small/reversible changes; it escalates to the member only
on large/irreversible ones:

- **Act alone:** same cabin, within ~12h of original arrival, under the cost cap,
  refundable hotel change, same-day.
- **Escalate:** over the cost cap, overnight stay, cabin downgrade, non-refundable
  change, or a trip cancellation/refund.
- **Split:** act on the safe part (the flight), escalate only the risky part
  (e.g. a non-refundable hotel).

## Tech stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Frontend | React Native | member-facing app |
| Backend | Node.js + Express | hosts agent, provider interface, simulator |
| Agent flow | LangGraph | orchestrates the step sequence only |
| Decisions | **plain deterministic code** | ALL money/booking/scoring logic — never an LLM |
| Travel data | **Sabre APIs** | flight search + hotel availability |
| Durable store | PostgreSQL | trip + audit trail of every automatic action |
| Cache | Redis | caches search results only (no seat holds in this build) |
| Live updates | Server-Sent Events (SSE) | pushes agent progress to the app |
| Notifications | WhatsApp + email | in-app card is the always-works fallback |
| Hosting | AWS | demo runs locally |

**Critical constraint:** LangGraph orchestrates the *flow*, but every decision
that touches money or booking MUST stay in deterministic code. Do not move
scoring, spending-limit checks, or the booking sequence into an LLM call. They
must be predictable, explainable, and auditable.

## Sabre API usage (search only)

The project uses Sabre for the "information" half. Relevant endpoints:

- **Authentication** — Sabre REST token (client credentials). Token is
  short-lived; refresh automatically before expiry. A lapsed token is the most
  common live-demo failure — wrap token handling.
- **Bargain Finder Max (flight search)** — the primary source of replacement
  flight options. Also used to seed the simulator's inventory at startup.
- **Flight schedules / status** — reference data for displayed legs.
- **Hotel Availability / Search** — alternative accommodation when an overnight
  is needed.

Sabre is NEVER asked to cancel/reissue a real ticket — that is the simulator's
job behind the provider interface.

> Live-account note (found during Phase 0 integration): this project's trial
> Sabre account only has **InstaFlights** (`GET /v1/shop/flights`) provisioned,
> not the full Bargain Finder Max product (`POST /v2/shop/flights` 404s: "No
> service exists for" that resource). Hotel search also 404s on every endpoint
> path tried — that product isn't enabled on this account either. Treat both as
> account-specific gaps, not code bugs, and verify against the Sabre Dev Studio
> portal before assuming a "standard" endpoint is actually reachable.

## Data model

Stored in PostgreSQL. The trip is a set of linked "nodes":

- `trip` — pnr, member, tier, policy profile.
- `node` — one booking; fields: id, type (FLIGHT | GROUND | HOTEL | COMMITMENT),
  status, `reversible`, `refundable`, `dependsOn[]`.
- `audit` — every automatic action + the policy decision that authorised it.

Two fields carry most of the weight:
- `reversible` — governs how much autonomy the policy engine grants.
- `dependsOn` — tells impact analysis what to re-check when an upstream node fails.

Redis: `search:{route}` cached results with a short TTL. No seat-hold keys in
this build.

## Components (the agent core)

- **Watcher** — polls trip state, emits disruption events (Phase 2).
- **Impact Analyser** — walks the graph, produces the impact list (Phase 3).
- **Option Engine** — searches (Sabre), filters, scores (Phase 4).
- **Policy Engine** — act / split / escalate (Phase 5).
- **Executor** — book directly, then release old; rollback on failure (Phase 6).
- **Notifier** — composes the single member message.
- **Provider Port** — the swappable interface to Sabre / simulator / real ticketing.

## Build phases (dependency order)

0. Foundation — Sabre connectivity + backend skeleton. *implemented*
1. Simulator + control panel (cancel/delay/fail buttons). *implemented*
2. **Detection** (Watcher). *implemented; see `src/agent/detection.js`*
3. **Impact analysis** (blast radius). *implemented; see `src/agent/impact.js`*
4. Option search + scoring.
5. Policy engine.
6. Safe booking + rollback.
7. App screens + SSE live updates.
8. Notifications + audit trail.
9. Hardening (circuit breaker fallback) + scale.

Principle: get steps 0–6 working as one loop before adding polish (LangGraph
wiring, WhatsApp, AWS).

## Phase 2 & 3 modules (already written)

Two pure modules exist and are tested:

- `src/agent/detection.js` — `detectDisruptions(trip)` — disruption events. Two
  checks: explicit cancellation, and connection-feasibility (delay breaks a
  connection).
- `src/agent/impact.js` — `analyseImpact(trip, event)` — impact list. Walks
  `dependsOn` downstream and classifies each node (shift hotel, retime/cancel
  ground, commitment at risk → escalate).

Both are PURE (no polling, no DB, no network). They answer "is something wrong?"
and "what does it break?" only, then hand off to Phase 4.

## Member-facing app (separate from the Phase 1 control panel)

`public/` is the internal judge-facing simulator control panel (vanilla JS,
not React Native) — not the member app described in the tech stack table. The
actual member-facing React Native (Expo) app lives in `mobile/`, with its own
backend routes (`/auth`, `/search/*`, `/tracking`, `/history`) that are
separate from the simulator/agent-core routes. Flights use real Sabre data
(InstaFlights); hotels and cabs are mock data (see the live-account note
above for why). Accounts/history persist in MongoDB, not the in-memory
simulator store — that data needs to survive a restart.

## Conventions & guardrails for the AI assistant

- Route ALL external calls through the provider interface, never directly.
- Keep money/booking/scoring in deterministic code, never in an LLM.
- Preserve the booking order: confirm new before releasing old.
- Every mutating request needs an idempotency key.
- Write the audit record for every automatic action.
- Prefer pure functions for agent logic (easy to test).
- Times are ISO 8601 strings throughout.
- Don't add a database for demo-only data that doesn't need to persist.

## What "done" looks like for the demo

A judge triggers a cancellation in the simulator; within seconds the app shows
detection, the agent searches real Sabre flights, scores them, books directly,
releases the old ticket, shifts the hotel, and sends one message — with live
metrics (detection speed, recovery time) on screen. Then a forced booking failure
shows the agent keeping the old ticket and retrying. Never a stranded member.
