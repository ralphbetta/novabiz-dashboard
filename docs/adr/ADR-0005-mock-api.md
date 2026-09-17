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
- an **idempotency store** keyed by `Idempotency-Key`: a repeated key with the **same payload** returns `202` with the transfer's
  **current state** and an `Idempotent-Replayed: true` header, instead of creating a second transfer.
  The same key with a **different payload** is refused with `409 IDEMPOTENCY_KEY_REUSED` and writes
  nothing. A rejection reached while processing (e.g. insufficient funds) **is** bound to its key:
  every later request with that key gets the same rejection, even if funds arrive meanwhile. That is
  what makes `rejected: true` a promise the server can keep — otherwise an original attempt still in
  flight could land after a retry was refused, and succeed (ADR 0007).
  *Why current state rather than a byte-for-byte replay of the first response:* a client retrying
  after a timeout needs to learn that the transfer has since settled, not be told `pending` again;
- **pending transfers that settle asynchronously** — a transfer returns `202 pending` and
  resolves to `successful` or `failed` a few seconds later, which is how NIP actually behaves
  and is what makes the reconciliation in ADR 0006 meaningful rather than theoretical.

### The chaos controls

Implemented in `src/mocks/chaos.ts`, applied by `handlers.ts`, and available whenever the mock is on —
so in a deployed demo too. They are driven from the **Mock API panel** (the "Mock API" button in the top bar), and
from the browser console or Playwright through `window.novabizChaos`.

| Control | Range | Default | Why it exists |
|---|---|---|---|
| `latencyMs` + `jitterMs` | 0–30,000 ms each | 400 + up to 300 | Makes loading states real |
| `errorRate` | 0–1 | 0 | The brief's explicit requirement: a `500 INTERNAL_ERROR`, `rejected: false` |
| `timeoutRate` | 0–1 | 0 | The "no answer at all" case, distinct from an error: the client's own timeout must end it |
| `afterCommitRate` | 0–1 | 0.5 | For injected write failures, the share that happen **after** the transfer is written |
| `settlementFailureRate` | 0–1 | 0 | An accepted transfer that later fails to settle |
| `forceNextTransfer(…)` | `success`, `error-before-commit`, `error-after-commit`, `timeout-before-commit`, `timeout-after-commit` | none | Makes the demo deterministic on interview day |
| `forceNextSettlement(…)` | `successful`, `failed` | none | Same, for settlement |

**Why a commit point.** A plain failure rate cannot express the distinction ADR-0006 turns on. An error
*before* commit means no money moved. A timeout *after* commit means money moved and the client was
never told — the case reconciliation exists for, and the E2E test ADR-0011 calls the most important.
So every injected write failure is placed before or after the write.

**Why forced outcomes.** A probabilistic failure rate is untestable and undemonstratable. Being able to
say "the next transfer will time out after it goes through" and then show the reconciliation is the
difference between claiming the behaviour works and showing it. A forced transfer outcome is consumed
only by a transfer POST, so balance, feed and status requests polled in between cannot use it up. An
*after*-commit outcome goes further: it stays armed until a POST actually creates a transfer, so a
replay, or a transfer the db rejects, cannot use it up without money moving. While it is armed, the
random rates still apply to every other POST: a random before-commit failure stops that POST reaching the
db, and the forced outcome waits for the next POST that does create a transfer. So with a non-zero error or
timeout rate, a forced after-commit outcome may fire on a later POST than the one you meant — set the rates
to zero for a deterministic demo. A forced settlement binds to the next transfer *created*, not whichever
pending transfer settles first.

The earlier draft's `duplicate-key` option was dropped: a same-key retry from the client already
produces a replay, and a same-key request with a different body already produces
`IDEMPOTENCY_KEY_REUSED`. Neither needs a forced outcome.

**All awaiting happens before the db.** Latency, and a timeout or error *before* commit, are applied
before the db call; an *after*-commit failure only discards the response. The db's check-then-write stays
atomic. A request that fails validation is answered at once, with no latency or injected failure.

**"After commit" means a transfer was actually written.** An after-commit failure — random or forced — is
applied only to a POST that created a transfer. A request that wrote nothing keeps its real answer: a
replay returns its `202`, and a db rejection returns its `422 INSUFFICIENT_FUNDS` with `rejected: true`.
Replacing those with a `500` would be safe, since the client would reconcile rather than roll back, but it
would make `afterCommitRate: 1` untrue to its own description.

**Latency longer than the client's timeout reproduces the in-flight race.** Settings allow up to 30s of
latency plus 30s of jitter, well past the client's 15s timeout (ADR-0014). With that, the client gives up,
its reconciliation lookup gets a `404`, and only then does the transfer commit — exactly the sequence in
ADR-0006's "Why a miss is not an answer". It is a more realistic demonstration of that race than any forced
outcome, and `chaos.test.ts` covers it.

**A timeout is long, not endless.** It holds the response for `TIMEOUT_HOLD_MS` (60s) — well past the
client's 15s request timeout (ADR-0014) — then releases it. It is not held forever because the mock is a
service worker: a fetch event that never settles can get the worker terminated by the browser, and MSW's
worker then forgets its clients and lets every request through to the real network, silently switching
the mock off. A before-commit timeout releases a 500, since nothing was written.

**Random draws are fixed per request.** Every request draws exactly `ROLLS_PER_REQUEST` (five) rolls —
read or write, forced or not, and whether or not it goes on to create a transfer. With a seeded random
source, nothing about one request shifts which later requests the rates hit. An earlier version drew the
settlement roll only when a transfer was created, so a replay, a db rejection or a before-commit failure
drew one roll fewer and shifted every later roll; the per-request count is now tested for each of those.

**Settings are strict.** `update()` and the constructor throw on an out-of-range value *or an unknown key*.
They are typed by hand in the browser console, where `update({ latency: 5000 })` for `latencyMs` would
otherwise return normally and change nothing.

`reset()` restores the settings the controller was **created with** — the defaults plus any overrides — and
clears anything forced. In the browser those are the defaults; a test that builds a controller with custom
settings gets its own back. It keeps settlement outcomes already fixed for existing transfers, since those
were decided when the transfers were created.

*The panel* (`src/features/mockControls/`): a "Mock API" button in the top bar on every page — a visible badge that the
data is simulated, with a count when anything differs from a normal server, including a slow network — opens a side panel with the next-transfer outcome (each
explained in terms of whether money was sent), the next settlement, network presets and sliders, "Reset demo data"
behind a confirmation, and "Reset controls". It watches the controller through `subscribe`/`getSnapshot`, so an armed
outcome disappears from the panel the moment a transfer uses it. It sits in the top bar rather than floating, so it can
never cover the Send button.

*Settings survive a reload; armed outcomes do not.* The network settings are saved to `localStorage`
(`chaosSettingsStorage.ts`) and validated on load. A forced outcome is meant for the next transfer made now; firing it
after a reload would surprise. **This departs from ADR-0004**, which planned the settings in a Redux preferences slice:
the controller already owns them, and a second copy in Redux would be one more thing to keep in sync. The panel reaches
the controller through a React context set when the mock starts, and **is lazy-loaded only then**, so neither it nor the
mock code it uses is in the main bundle; a build without the mock never downloads it. (The first version imported it
statically, which put `chaos.ts` in the main chunk while this ADR said otherwise; review caught it. Checked by searching
the built main chunk for mock-only strings, in builds with and without the mock.) The browser's controller starts from
the defaults and then applies the saved settings, so `novabizChaos.reset()` still means a normal server.

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

*The mock runs in every build, including production.* It starts unless `VITE_USE_MOCK` is
explicitly `"false"`.

An earlier draft of this ADR started the worker only under `import.meta.env.DEV`, so that a real
deployment could not silently keep mocking. That reasoning assumes a real backend exists. None does,
and none will for this project. A dev-only mock would mean that `npm run build && npm run preview`,
or a deployed demo link on interview day, serves an app in which every request fails and every
screen shows its error state. The failure mode the original rule guarded against — mocking where a
real API was expected — cannot occur without a real API, while the failure mode it *caused* was
certain.

So the default is inverted: mocking is on unless switched off. When a real backend exists, setting
`VITE_USE_MOCK=false` in that environment is the whole change, and the app's data layer does not
change at all.

*Service workers need a secure context.* MSW's browser worker only registers on `https://` or
`localhost`. That has two practical consequences:
- a deployed demo must be served over HTTPS, which every mainstream static host does by default;
- **opening the dev server from a phone over the LAN (`http://192.168.x.x:5173`) will not work** —
  the worker refuses to register and every request fails. This matters for the open item of testing
  on a real low-end Android device: use an HTTPS tunnel or a deployed build, not a LAN address. The
  app must detect a failed worker registration and say so plainly, rather than presenting it as a
  network error.

*Seed rows are first-class.* Seed debits carry idempotency keys, so those keys are registered with
the store: a seed transfer can be looked up, and its key can never be reused for a new transfer.
Pending seed rows settle a few minutes after the mock starts — visible as pending first, never holding
funds forever.

*State survives a reload* (decided by the product owner: "we can't be losing data on reload"). The whole mock database
— the ledger, idempotency records including bound rejections, pending settlements, beneficiaries and the id sequence —
is saved to `localStorage` (`src/mocks/persistence.ts`) and restored on start. A write is saved the moment the database
commits it, before any held or failed reply, so a reload straight after sending cannot lose it; reads are saved at most
every 250 ms, because reading can settle a pending transfer; a pending save is flushed on `pagehide`. Saved data is
untrusted: it is validated against the contract on load, and anything malformed, from another version or another seed
is discarded for the seed. `novabizMock.resetData()` clears it, blocks every later save (one already scheduled, one from
a request finishing before the unload, the `pagehide` save) so none can write the old data back, and forgets the app's
open-transfer key, which would otherwise be checked against the fresh data. This is what makes ADR-0006's same-key
*Try again* and reconciliation after a reload work in the demo as they would against a real, durable server.

*The mock supports one tab.* Each tab holds its own copy of the database and saves all of it to the same key. A tab
only saves when its own data has changed, so a tab that merely reads cannot erase a transfer made in another; but if two
tabs both write, the last to save wins, and a transfer from the other tab can be lost. Syncing tabs through the `storage`
event was considered and not built: a mock does not need it, and a real server has one database. The chaos settings reset
on reload. The saved data includes beneficiaries' full account numbers; in production that data lives on the bank's
servers, never in the browser.

*Startup never leaves a blank page.* `index.html` shows a loading message from first paint, before any
JavaScript. The app then renders at once and requests wait for the worker, each for a bounded time; a
request that runs out of time is refused *without being sent*. A slow start is not final: if the worker has
not started within 15 seconds the page says it is taking longer than usual, and the notice clears when it
does start, after which requests succeed. An earlier version turned the 15s timeout into a permanent failure
that only a reload could clear, even if the worker started a second later. Only a real failure — the worker
refusing to register — asks for a reload.

*Unexpected errors are contract-valid.* Every handler is wrapped so a thrown exception becomes a
`500 INTERNAL_ERROR` with `rejected: false`, never MSW's generic 500 body. A crash part-way through a
transfer may have written something, so the client must reconcile rather than roll back (ADR-0006).
A test drives a crash through every endpoint.

*Bundle cost — an open decision.* The mock chunk is ~523 kB minified (~188 kB gzipped), and startup
waits for it before first render. By source size it is mostly zod (361 kB, which the app will need
anyway from Phase 3), msw (208 kB), and MSW's cookie handling via tldts and tough-cookie (257 kB),
which this API does not use. Because the mock now ships in production builds, the target audience on
slow connections pays this. Not yet resolved; see the implementation plan.

## How we would know we were wrong

- A real backend is introduced and some environment is still mocking because `VITE_USE_MOCK` was
  never set to `false` there. Mitigation, built: the "Mock API" button is in the top bar whenever the mock is on, so a
  mocked environment cannot be mistaken for a live one.

- Handler logic grows past the point where it is obviously correct at a glance, and starts
  needing its own tests — at which point the "server" wants to be a real service.
- We find ourselves adding app-side code paths that exist only for the mock.
