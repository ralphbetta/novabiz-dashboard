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
| 2 | MSW mock API — seeded ledger, pagination, idempotency, chaos controls, Mock API panel | ✅ Done (panel built after Phase 6) |
| 3 | Data layer — Redux Toolkit store, RTK Query endpoints | ✅ Done; used by the dashboard screens |
| 4 | Dashboard layout, balance summary, paginated transactions table | ✅ Done |
| 5 | Send Money wizard — account lookup, recent recipients, optimistic send, settlement tracking | ◐ Built and tested; not yet reviewed |
| 6 | Reconciling transfers whose outcome is unknown | ◐ Built and tested; not yet reviewed |
| 7 | Offline handling, retry, dark mode | Not started |
| 8 | Component + Playwright E2E tests | Not started |
| 9 | Docs, accessibility pass, polish | Not started |

## Running it

Requires Node 20+ (developed on Node 24).

```bash
npm install
npm run dev         # Vite dev server
```

Open http://localhost:5173 — it redirects to `/dashboard`. The routes are `/dashboard` (overview),
`/dashboard/transactions` and `/dashboard/send-money`. The mock API starts automatically with the dev server — no second process — and also
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

## Trying the failure modes

The mock API can be made slow, made to fail, or made to go silent — including *after* a transfer has
gone through, which is the case the app's reconciliation exists for. Open the **Mock API** button in the top bar: pick
what the next transfer does ("Timeout, money sent", "Error, nothing sent"…), whether the next one settles, and the
network presets. Network settings are kept after a reload; an armed outcome is used by the next transfer only. The same
controls are available in the browser console (and to Playwright):

```js
novabizChaos.forceNextTransfer('timeout-after-commit') // next transfer created goes through; reply held 60s
novabizChaos.forceNextTransfer('error-before-commit')  // next transfer fails, nothing moves
novabizChaos.forceNextSettlement('failed')             // next transfer is accepted, then fails to settle
novabizChaos.update({ latencyMs: 2000, errorRate: 0.2 })
novabizChaos.reset()
```

Run one, then send money from `/dashboard/send-money`:
- `timeout-after-commit`: after the 15s client timeout the receipt says **"We're confirming this transfer"**, rows read
  *Awaiting confirmation*, other pages show a notice, and about a second later reconciliation finds the transfer and it
  settles. Reload during the check and the receipt comes back from the stored key.
- `timeout-before-commit`: nothing is ever written, so every check misses; after about two minutes the receipt offers
  **Check status** and **Try again** (same key, so it cannot pay twice).
- Any account number starting **999** shows "No account found". Chaos settings reset when the page reloads; the mock's
  data does not (see below). Full reference:
  [ADR-0005](docs/adr/ADR-0005-mock-api.md).

## What is built

### Send Money — [src/features/send](src/features/send)

- **Recipient:** pick a recent recipient (side panel on desktop, a row of avatars on phones) or enter an account number
  and bank. The holder's name is looked up automatically and shown as verified; the merchant never types a name, and the
  server refuses a transfer whose name does not match. → [ADR-0018](docs/adr/ADR-0018-account-lookup-and-beneficiaries.md)
- **Amount:** a large text field with a decimal keypad, quick amounts, and a live summary of the balance after the
  transfer. Zero, negative, malformed, below-minimum and over-balance amounts are refused with announced errors.
- **Review:** the verified name, the full account number (the only place it appears) and the exact amount, with every
  rule checked again. **Result:** a receipt that follows the transfer until it settles.
- **Layout:** the main action is on screen without scrolling at 1440×900; on phones the buttons stick to the bottom.
- **Optimistic send:** the balance drops and a pending row appears before the server answers. Only a definite rejection
  undoes that; a timeout or server error keeps it and says the money may have been sent. The idempotency key is created
  once per attempt. → [ADR-0006](docs/adr/ADR-0006-optimistic-send.md), [ADR-0007](docs/adr/ADR-0007-idempotency.md)

**Tests:** the whole flow against the real mock server (validation and announcements, lookup found / not found /
failed, recent recipients, focus, review re-checks, optimistic update, settlement, double tap, definite rejection,
unknown outcome, leaving mid-transfer) and the store-level optimistic update for every forced failure mode.


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

### Dashboard UI — [src/app](src/app), [src/features](src/features)

- **One layout route** with a sidebar (a native `<dialog>` drawer below 1024px) and a sticky top bar. Navigating
  moves focus to the page heading and updates the tab title.
- **Overview**: balance card with hide-amounts and refresh, money in and out today, and the six latest transactions.
- **Transactions**: a full-width table filtered by direction, status and date (sent to the server), paginated with
  25–1,000 rows per page. The body is virtualised, so a 1,000-row page keeps about 20 rows in the DOM. Every
  request shows a loading, empty (new merchant vs. no filter matches) or error-with-retry state, and page changes
  are announced to screen readers. → [ADR-0016](docs/adr/ADR-0016-paginated-transactions-table.md)
- **Dropdowns** are one custom `Select` built to the WAI-ARIA combobox pattern, with full keyboard support.
  → [ADR-0017](docs/adr/ADR-0017-custom-select-and-native-dialog.md)
- **Styling**: Tailwind v4 with colour tokens for light and dark in [src/styles/index.css](src/styles/index.css).
  There is no theme toggle yet (Phase 7).

**Tests:** component tests with Testing Library and axe for the balance card (loading, error and retry, hide
amounts, refresh announcements), pagination controls and range, recent transactions (loading, empty, error), `Select`,
the transactions section (focus and announcements on page, filter and page-size changes), the announcer and route
focus. A contrast test ([src/styles/tokens.test.ts](src/styles/tokens.test.ts)) checks hand-listed colour pairs in
light and dark, and uses the CSS Tailwind generates to confirm every colour in use is in a checked pair. It found a
focus outline too faint on the dark blue sidebar, now fixed. It does not work out which colours actually overlap; that
needs a rendered page.

**Performance, measured** on the production build in desktop Chrome, with mock latency set to 0 so the numbers are
the app's own work (one run each, on a MacBook; not a real phone):

| | Switch to 1,000 rows per page | Rows in the DOM | Scrolling the full 1,000-row page for 3s |
|---|---|---|---|
| 1440px | 180 ms | 23 | 181 frames (60 fps), worst frame 17 ms, no long tasks |
| 360px, CPU throttled 6× | 280 ms, long tasks of 73 and 104 ms | 21 | 173 frames (~58 fps), worst frame 50 ms, one 57 ms long task |

The switch includes the mock service worker building and validating the 1,000-row response. Measured with a
Playwright script using Chrome's CPU throttling and `PerformanceObserver`, not the React DevTools Profiler, which
cannot run headless. Not yet confirmed on a real low-end Android phone.

### Lint guards — [eslint.config.js](eslint.config.js)

The branded type cannot stop `{amount / 100}` in a component, because a `Kobo` is still a number.
An ESLint rule does: `/ 100`, `* 100`, `* 0.01`, `/ 0.01` and `.toFixed()` fail the build outside
the money module. A second rule bans `dangerouslySetInnerHTML` (ADR-0013). A test asserts both
actually fire.

**Known gaps, stated plainly.** The rule matches syntax, not values, so it does not catch a named
constant (`const K = 100; amount / K`) or chained division (`amount / 10 / 10`). Closing either
needs data-flow analysis. Both are pinned as uncaught by tests, so the documentation cannot drift
into claiming otherwise.

## Architecture

Recorded as ADRs. Each item says whether it is built.

**State and data fetching: Redux Toolkit with RTK Query** *(built — `src/api`, `src/store`, used by the
dashboard screens)*. Almost all state here is a cached copy
of server data — balance, feed, transfer results — which RTK Query manages: caching, pagination,
loading and error states, optimistic patches. The little genuinely client-owned state (the Send
Money draft, theme) lives in plain RTK slices in the same store, so there is one store and one
DevTools timeline. TanStack Query was the close alternative. →
[ADR-0003](docs/adr/ADR-0003-server-state.md), [ADR-0004](docs/adr/ADR-0004-client-state.md)

**Mock API: MSW at the network layer** *(built)*. The app makes real HTTP requests and cannot tell it is
mocked. The same handlers serve the browser, component tests and E2E tests. It includes
simulated latency, a configurable failure rate, and deterministic "force the next request to fail
or time out" controls, so error paths can be demonstrated on demand. →
[ADR-0005](docs/adr/ADR-0005-mock-api.md)

**Optimistic send: four states, not two** *(built)*. A timeout or `5xx` does not mean the transfer failed —
it may have gone through. So only an explicit rejection rolls back. An ambiguous outcome moves to
an `unknown` state that keeps the balance reduced, tells the merchant not to resend, and reconciles
against the server using the idempotency key. →
[ADR-0006](docs/adr/ADR-0006-optimistic-send.md), [ADR-0007](docs/adr/ADR-0007-idempotency.md)

**Transactions: pages, not infinite scroll** *(built)*. Previous, Next and First page controls rather than page
numbers, because the API pages by cursor and cannot jump to page 17. Rows per page up to 1,000, with a virtualised
body. Replaced the planned infinite feed at the product owner's request. →
[ADR-0016](docs/adr/ADR-0016-paginated-transactions-table.md)

**UI primitives: no component library** *(built)*. Tailwind v4, a native `<dialog>` for the mobile drawer and a
custom accessible `Select`, instead of Radix. →
[ADR-0010](docs/adr/ADR-0010-styling-responsive.md), [ADR-0017](docs/adr/ADR-0017-custom-select-and-native-dialog.md)

**Account names come from a lookup** *(built)*. The merchant enters a number and bank; the holder's name is looked
up and verified, and checked again by the server. Recent recipients are one tap away. →
[ADR-0018](docs/adr/ADR-0018-account-lookup-and-beneficiaries.md)

The full set of 18 decisions is indexed in [docs/adr/](docs/adr/README.md).

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
- **The mock's data is saved in the browser** (`localStorage`) so transfers survive a reload, like a real server. Run
  `novabizMock.resetData()` in the console to start again from the seed. **Use one tab:** each tab keeps its own copy,
  and if two tabs both send money, the last to save wins (ADR-0005).
- **Mock bank names are invented.** The account lookup stands in for a real name enquiry (ADR-0018).
- **Accessibility is checked with axe in component tests, not a lint plugin.** `eslint-plugin-jsx-a11y` does not
  support ESLint 10. axe in jsdom cannot check colour contrast, so a separate test checks the token pairs.
- **No route lazy-loading yet.** The main JavaScript chunk is about 212 kB gzipped (210 kB in a build without the mock);
  the Mock API panel and the mock itself load separately.

## Repository layout

```
src/lib/money.ts             Public money API
src/lib/money.internal.ts    Formatting mechanics, split out for direct testing
src/lib/time.ts              Business-day boundaries (WAT)
src/api/contracts.ts         Zod API contract, shared by the app and the mock server
src/mocks/seed.ts            Seeded data: 1,200 transactions, stable across time of day, incl. hostile fixtures
src/mocks/db.ts              Mock server state and business rules: ledger, pagination, idempotency
src/mocks/handlers.ts        Mock API HTTP layer (MSW)
src/mocks/chaos.ts           Chaos controls: latency, errors, timeouts, forced outcomes
src/mocks/directory.ts       Mock bank directory: who holds an account (account-name lookup)
src/mocks/browser.ts         Starts the mock as a service worker
src/api/                     RTK Query API, base query (timeouts, retries), shared contracts, bank list
src/store/                   Redux store, Send Money draft slice, transfer tracker (follows a transfer until it settles)
src/app/                     Router, dashboard layout, sidebar and top bar, route focus
src/pages/                   One component per route
src/features/balance/        Balance card and today's totals
src/features/transactions/   Transactions table, filters, pagination, recent transactions
src/features/send/           Send Money wizard: steps, account lookup, recent recipients, summary, receipt
src/components/ui/           Avatar, Button, Icon, Select, Skeleton, StatusBadge, TextField
src/components/feedback/     Screen-reader announcer, loading/empty/error message
src/styles/index.css         Tailwind v4 entry and colour tokens (light and dark)
src/**/*.test.ts(x)          Unit, property-based, contract, seed, lint-guard and component tests
src/source-hygiene.test.ts   Fails on raw invisible, bidirectional or look-alike characters
docs/adr/                    Architecture Decision Records
docs/IMPLEMENTATION_PLAN.md  Phased build plan and progress
AGENT.md                     Standing instructions for AI coding tools in this repo
AI_USAGE.md                  How AI tools were used, including where they were wrong
```
