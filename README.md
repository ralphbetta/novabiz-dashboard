# NovaBiz Merchant Dashboard

A React + TypeScript dashboard for small merchants on FirstBank NovaPay's NovaBiz module: a live
view of money coming into the wallet, and a way to send money out. Built for the Frontend Engineer
(ReactJS) take-home.

> **Status: in progress.** This README describes the repository as it is, not as planned. What is
> built is marked built; what is decided but not yet built is marked as such. Progress is tracked
> phase by phase in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

## Progress

| Phase | Scope | State |
|---|---|---|
| 0 | Scaffold, strict TypeScript, lint guards, test runner | ◐ Partly done |
| 1 | Money module — kobo integers, formatting, parsing | ✅ Done |
| 2 | MSW mock API — seeded ledger, pagination, idempotency, chaos controls | ◐ Parts 1–2 of 3: chaos controls remain |
| 3 | Data layer — Redux Toolkit store, RTK Query endpoints | Not started |
| 4 | Balance summary + virtualised transaction feed | Not started |
| 5 | Send Money wizard | Not started |
| 6 | Optimistic update reconciliation | Not started |
| 7 | Offline handling, retry, dark mode | Not started |
| 8 | Component + Playwright E2E tests | Not started |
| 9 | Docs, accessibility pass, polish | Not started |

## Running it

Requires Node 20+ (developed on Node 24).

```bash
npm install
npm run dev         # Vite dev server
```

**At this stage `npm run dev` serves the Vite starter page.** No dashboard UI exists yet; it starts
in Phase 4. The mock API now starts automatically with the dev server — no second process — and also
in production builds, since there is no real backend
([ADR-0005](docs/adr/ADR-0005-mock-api.md)). Because it runs as a service worker, the app must be
served from `localhost` or over HTTPS: opening the dev server from a phone via a LAN IP will not work.

```bash
npm test            # Vitest, run once
npm run test:watch  # Vitest, watch mode
npm run lint        # ESLint, including the money and HTML-injection guards
npm run typecheck   # TypeScript
npm run build       # Type-check and production build
```

All five currently pass.

## What is built

### Money handling — [src/lib/money.ts](src/lib/money.ts)

The brief's first hard constraint. Every amount is an **integer number of kobo** from the API
boundary to the moment of display; a decimal exists only inside the formatter. Full reasoning in
[ADR-0002](docs/adr/ADR-0002-money-formatting.md).

- **Branded `Kobo` type**, constructible only through `toKobo()`, which rejects fractions,
  non-finite values and unsafe integers.
- **Formatting via `Intl.NumberFormat`**, passing a decimal *string* built with integer arithmetic,
  so no float is ever created: `100050` → `₦1,000.50`.
- **An exact fallback** for engines without Intl V3 string input, which low-end Android WebViews may
  lack.
- **`currencyDisplay: 'narrowSymbol'`**, so a device missing `en-NG` locale data still shows `₦`
  rather than `NGN`.
- **A strict parser** that rejects malformed grouping (`1,0,0,0`) and never uses `parseFloat`.
- **Overflow-checked arithmetic** that throws rather than silently losing precision.

**Tests.** A table of edge cases, plus property-based tests with fast-check:
- a round-trip, `parseNairaInput(formatNaira(k)) === k`, over 10,000 random amounts;
- fallback-vs-primary agreement over 5,000.

The agreement test found a real bug. The first fallback was one kobo out above ~₦10 trillion, and
no hand-written case had used an amount that large.

### Lint guards — [eslint.config.js](eslint.config.js)

The branded type cannot stop `{amount / 100}` in a component, because a `Kobo` is still a number.
An ESLint rule does: `/ 100`, `* 100`, `* 0.01`, `/ 0.01` and `.toFixed()` fail the build outside
the money module. A second rule bans `dangerouslySetInnerHTML` (ADR-0013). A test asserts both
actually fire.

**Known gaps, stated plainly.** The rule matches syntax, not values, so it does not catch a named
constant (`const K = 100; amount / K`) or chained division (`amount / 10 / 10`). Closing either
needs data-flow analysis. Both are pinned as uncaught by tests, so the documentation cannot drift
into claiming otherwise.

## Architecture — decided, not yet built

These decisions are recorded as ADRs. None of the code below exists yet.

**State and data fetching: Redux Toolkit with RTK Query.** Almost all state here is a cached copy
of server data — balance, feed, transfer results — which RTK Query manages: caching, pagination,
loading and error states, optimistic patches. The little genuinely client-owned state (the Send
Money draft, theme) lives in plain RTK slices in the same store, so there is one store and one
DevTools timeline. TanStack Query was the close alternative. →
[ADR-0003](docs/adr/ADR-0003-server-state.md), [ADR-0004](docs/adr/ADR-0004-client-state.md)

**Mock API: MSW at the network layer.** The app makes real HTTP requests and cannot tell it is
mocked. The same handlers serve the browser, component tests and E2E tests. It will include
simulated latency, a configurable failure rate, and deterministic "force the next request to fail
or time out" controls, so error paths can be demonstrated on demand. →
[ADR-0005](docs/adr/ADR-0005-mock-api.md)

**Optimistic send: four states, not two.** A timeout or `5xx` does not mean the transfer failed —
it may have gone through. So only an explicit rejection rolls back. An ambiguous outcome moves to
an `unknown` state that keeps the balance reduced, tells the merchant not to resend, and reconciles
against the server using the idempotency key. →
[ADR-0006](docs/adr/ADR-0006-optimistic-send.md), [ADR-0007](docs/adr/ADR-0007-idempotency.md)

The full set of 15 decisions is indexed in [docs/adr/](docs/adr/README.md).

## Assumptions

The brief leaves these open; each is a judgement call, recorded so it can be challenged.

| Assumption | Why |
|---|---|
| The merchant is already signed in; there is no login screen. | The brief starts at the dashboard. Auth would cost time and demonstrate nothing assessed. |
| Single currency, NGN only. | The brief describes a Naira wallet. The diaspora corridor lands funds already converted to NGN. |
| Amounts are valid up to `Number.MAX_SAFE_INTEGER` kobo (~₦90 trillion). | Documented as a ceiling rather than engineered around with BigInt. Arithmetic past it throws. |
| Negative amounts render with a hyphen-minus (`-₦2,500.00`), not U+2212. | It is what `Intl` emits, so every negative in the app renders identically and round-trips through the parser. |
| **A minimum transfer of ₦100.** | **Not from the brief** — a plausible business rule, invented. It is the named constant `MIN_TRANSFER_KOBO` in the shared contract, and is enforced separately from the mandatory `> 0` rule, so lowering it could never admit a ₦0 transfer. |
| "Today" means the merchant's business day in West Africa Time (UTC+1), not the device's local day. | A merchant opening the app at 00:30 expects today's totals to have reset, whatever their phone's timezone setting. WAT has no daylight saving, which a test checks against real zone data. |
| Target devices may lack Intl V3 and full `en-NG` locale data. | The brief names low-end Android. **Verified on Node only** — not yet on a real device. |

## Open items

- **Not yet verified on a real low-end Android WebView:** the `₦` symbol fallback and `formatToParts`
  support. This is the strongest outstanding evidence gap for ADR-0002.
- **Send Money must reject zero and negatives.** `parseNairaInput` accepts both by design. The
  shared contract (`SendMoneyRequestSchema`) now rejects them with tests; the Phase 5 form must
  surface that error accessibly.
- The Vite starter assets (`src/App.tsx` demo, `hero.png`, `react.svg`, `vite.svg`) are still present
  and will be removed when the app shell is built.

## Repository layout

```
src/lib/money.ts             Public money API
src/lib/money.internal.ts    Formatting mechanics, split out for direct testing
src/lib/time.ts              Business-day boundaries (WAT)
src/api/contracts.ts         Zod API contract, shared by the app and the mock server
src/mocks/seed.ts            Seeded data: 1,200 transactions, stable across time of day, incl. hostile fixtures
src/mocks/db.ts              Mock server state and business rules: ledger, pagination, idempotency
src/mocks/handlers.ts        Mock API HTTP layer (MSW)
src/mocks/browser.ts         Starts the mock as a service worker
src/**/*.test.ts             Unit, property-based, contract, seed and lint-guard tests
src/source-hygiene.test.ts   Fails on raw invisible, bidirectional or look-alike characters
docs/adr/                    Architecture Decision Records
docs/IMPLEMENTATION_PLAN.md  Phased build plan and progress
AGENT.md                     Standing instructions for AI coding tools in this repo
AI_USAGE.md                  How AI tools were used, including where they were wrong
```
