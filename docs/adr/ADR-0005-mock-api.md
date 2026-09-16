# ADR 0005 — MSW is the API, not a test fixture

**Status:** Accepted · **Date:** 2026-09-16

## Context

There is no backend. The brief says we own the API layer "including how you fake it", and
requires simulated latency and a **configurable failure rate** so error states can actually
be demonstrated.

There is a trap in how most people read that. If the mock is a set of stubbed functions
inside the app, then the app has never made an HTTP request, and none of the interesting
behaviour — timeouts, retries, idempotent replay, a 500 arriving after the UI said "sent" —
is ever exercised. The mock would validate the happy path and nothing else.

## Decision

Use **MSW (Mock Service Worker)** at the network layer, with **one set of handlers shared by
the browser app, the component tests, and the Playwright E2E run**.

The app's own code contains no branch that knows it is talking to a mock.

The handlers implement a small **stateful in-memory server**, not canned responses:

- a seeded dataset of **1,200+ transactions**, generated deterministically from a fixed seed
  so screenshots, tests, and the demo are reproducible;
- **cursor-based pagination** with server-side filtering by date range, status and type;
- a **balance** derived from the ledger, so a successful transfer genuinely changes it;
- an **idempotency store** keyed by `Idempotency-Key`, which **replays the original response**
  for a repeated key instead of creating a second transfer (ADR 0007);
- **pending transfers that settle asynchronously** — a transfer returns `202 pending` and
  resolves to `successful` or `failed` a few seconds later, which is how NIP actually behaves
  and is what makes the reconciliation in ADR 0006 meaningful rather than theoretical.

### The chaos controls

A dev-only panel, backed by the preferences store, exposes:

| Control | Range | Why it exists |
|---|---|---|
| Latency | 0–5000ms, with jitter | Makes loading states real |
| Failure rate | 0–100% | The brief's explicit requirement |
| Timeout rate | 0–100% | Produces the "no answer at all" case — distinct from failure |
| Force next send to | success / fail / timeout / duplicate-key | Makes the demo deterministic on interview day |

The last row matters: a probabilistic failure rate is untestable and undemonstratable. Being
able to say "the next transfer will time out" and then show the reconciliation is the
difference between claiming the behaviour works and showing it.

## Alternatives considered

**`json-server` or an Express mock.** Requires a second process, which breaks the
single-command requirement, and cannot be reused inside component tests.

**Hand-rolled `fetch` interception or a stubbed API module.** Fast to write, and it hides the
network entirely — see the trap above.

**Hard-coded JSON fixtures.** Cannot express pagination, settlement, or idempotent replay.

## Consequences

*What it buys:* the same handlers guarantee that a passing test corresponds to a working app.
Swapping in a real backend is deleting the worker registration and changing a base URL — the
app's data layer does not change at all.

*What it costs:* the service worker needs registering in `public/`, adds a small startup step
in dev, and the seeded dataset must stay in sync with the TypeScript contract types. We
mitigate the last one by deriving the generator from the same types the app consumes.

*Production safety:* the worker is started behind `import.meta.env.DEV` and an explicit
`VITE_USE_MOCK` flag. A build that ships to a real environment cannot silently keep mocking.

## How we would know we were wrong

- Handler logic grows past the point where it is obviously correct at a glance, and starts
  needing its own tests — at which point the "server" wants to be a real service.
- We find ourselves adding app-side code paths that exist only for the mock.
