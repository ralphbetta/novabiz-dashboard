# ADR 0011 — A test pyramid weighted toward the money and the send flow

**Status:** Accepted · **Date:** 2026-09-16

## Context

The brief asks for React Testing Library component tests and at least one Playwright/Cypress
E2E flow covering Send Money, and grades "tests that would actually catch a regression".

That phrasing rules out the usual filler. A snapshot test of a balance card catches a
whitespace change and misses a rounding bug. Coverage percentage is not the target; **the
probability that a real defect is caught before it ships** is.

## Decision

Weight the effort by blast radius. What breaks a merchant's money gets the most tests.

### Layer 1 — Unit tests (Vitest), on the pure logic

**`money.ts` — exhaustively, including property-based tests:**

| Case | Expectation |
|---|---|
| `0` | `₦0.00` |
| `1` | `₦0.01` |
| `100050` | `₦1,000.50` |
| `-250000` | `-₦2,500.00` |
| `99` | `₦0.99` — never `₦1.00` |
| `100` | `₦1.00` |
| `Number.MAX_SAFE_INTEGER` | `₦90,071,992,547,409.91`, no precision loss |
| `MAX_SAFE_INTEGER + 1` as a sum | throws rather than silently drifting |
| `formatSignedNaira(-x, 'credit')` | throws — no silently hidden sign mismatch |
| `"1,0,0,0"`, `"1,00.50"`, `"10 00"` | parser rejects malformed grouping |
| Round-trip property | `parseNairaInput(formatNaira(k)) === k` — fast-check, **10,000** runs |
| Fallback-agreement property | old-WebView fallback === primary path — fast-check, **5,000** runs |
| Locale fallback | formatting under `en` / `und` still renders `₦`, not `NGN` |
| Lint guard | `/ 100`, `* 100`, `.toFixed()`, `dangerouslySetInnerHTML` actually fail lint |

The two properties guard different things, and it matters which is which. The **round-trip**
guards format and parse against each other. The **fallback-agreement** property is the one that
caught a real bug: the first fallback was one kobo out above ~₦10 trillion. The round-trip could
not have found it, because on an engine with Intl V3 string input — Node included — it never
reaches the fallback. A property only tests the code path it actually executes.

The lint-guard test exists because ADR-0002's drift protection *is* a lint rule; a rule whose
selector silently stops matching is worse than no rule, since everyone still believes in it.

**`isDefiniteFailure`** — the classifier from ADR 0006, across every error shape the mock can
produce. A `500` must classify as *not* definite; a `422` must classify as definite. Getting
this backwards is the difference between a correct app and one that loses a merchant's money,
so it is tested directly rather than only through the UI.

**Idempotency key lifecycle** — same key across retries; new key when the amount changes;
cleared on terminal states only.

### Layer 2 — Component tests (RTL + MSW handlers)

Against the same handlers the app uses, so a passing test means a working screen.

- Balance card: loading skeleton → data → error → retry.
- Transaction feed: empty state; error + retry; filter changes hitting the right query;
  next page appending rather than replacing.
- Wizard: cannot advance with an invalid account number; amount above balance is rejected
  with the error associated to the field via `aria-describedby`; review step shows the
  formatted naira amount matching the kobo integer submitted.
- **Full keyboard traversal of the wizard**, driven by `user-event` with `Tab` and `Enter`
  only — never by clicking. A mouse-driven test cannot fail the way a keyboard user fails.
- `jest-axe` assertion on every rendered screen.

### Layer 3 — E2E (Playwright), the flows that must never break

1. **Happy path** — send ₦1,000.50, row appears pending, settles, balance changes by exactly
   100050 kobo (asserted against the mock's ledger, not against display text alone).
2. **Definite failure** — force a `422`. Optimistic row is removed, balance is restored to
   the exact prior kobo value, error is announced in the live region.
3. **Timeout → reconciliation, where the server DID record it.** Force a timeout on a transfer
   the mock server commits. Assert the row goes to `Awaiting confirmation`, **not** removed;
   assert the balance is **not** restored; assert reconciliation resolves it to settled.
   **This is the single most important test in the project** — it is the one that fails if
   someone "simplifies" ADR 0006 back to snapshot-and-restore.
4. **Retry does not double-send.** Force a timeout, tap *Try again*, assert the mock ledger
   contains exactly **one** entry for that idempotency key.
5. **Offline mid-send** — go offline via CDP, send, come back online, assert reconciliation
   resolves rather than duplicating.
6. **Responsive smoke** at 360px and 1440px: no horizontal scroll, wizard completable at both.

### What we deliberately do not test

No snapshot tests. No tests asserting that a component renders a `<div>`. No coverage
threshold gate — it incentivises testing getters. Coverage is reported, not enforced.

## Alternatives considered

**Cypress instead of Playwright.** Comparable. Playwright chosen for native multi-viewport
projects in one config (needed for test 6), real offline emulation via CDP (needed for test
5), and a faster CI run.

**Testing against stubbed modules instead of MSW handlers.** Faster, and it would let a test
pass while the app is broken, because the contract under test would be one we invented for
the test.

**Chasing high coverage.** Rejected explicitly. The tests above would likely land around
70–80% coverage; the remaining percentage is mostly presentational markup, where a test costs
maintenance and catches nothing.

## Implementation notes (Phase 8)

- **Where:** `e2e/send-money.spec.ts` and `e2e/support.ts`; `playwright.config.ts` runs a production build through
  `vite preview`, with a `desktop` (1440×900) and a `mobile` (360×800, touch) project. Each test has a fresh browser
  context, so fresh localStorage and a mock starting from the seed.
- **Money is asserted against the mock's ledger**, fetched inside the page by idempotency key (captured from the POST's
  header) and in kobo, as this ADR asked — not only against text on screen.
- **Failures are forced through the Mock API panel or `window.novabizChaos`.** Flow 3 uses the panel, as a reviewer would.
  To see *Awaiting confirmation* before reconciliation resolves it (about a second after the 15s timeout), the test raises
  the mock's latency once the POST is on its way.
- **Flow 2 needs a real `422`.** The form will not send more than the balance it shows, so the test spends almost all of
  it with a transfer made outside the app; the app's own check passes and the server refuses.
- **Flow 4 runs at desktop size only** and takes about 2.5 minutes: *Try again* appears only after real reconciliation
  gives up. The same rule is covered in milliseconds by store tests with shortened timings.
- **Flow 5 and the mock's service worker:** Playwright's offline mode does not stop a service-worker mock from answering,
  so the test asserts what matters — no reconciliation checks while offline, checking resumes on reconnect, and one ledger
  entry — rather than failed requests.
- **Added:** two flows after a reload (a sent transfer is still there; an unconfirmed one is found and settles), and the
  phone menu's close button.
- **Proven to catch regressions:** rolling back on every error fails flow 3; skipping the undo after a definite failure
  fails flow 2; not pausing while offline fails flow 5; a new key on *Try again* fails flow 4; not restoring the mock's
  saved data fails both reload flows.
- **Browser:** Playwright's Chromium, or `PLAYWRIGHT_CHANNEL=chrome` for an installed Chrome. Playwright's download failed
  repeatedly on this network, so the suite was run with the installed Chrome.

## Consequences

*What it buys:* the tests map one-to-one onto the ways this app can actually hurt a merchant.
Test 3 in particular encodes the reasoning in ADR 0006 so it survives the next refactor.

*What it costs:* E2E tests against a probabilistic mock need the deterministic override
controls from ADR 0005 to avoid flakiness — the chaos panel exists partly to make these tests
possible. Playwright adds CI time and browser downloads.

## How we would know we were wrong

- A defect reaches the demo that none of these tests could have caught — the tests are
  pointed at the wrong risks.
- Tests start failing for reasons unrelated to behaviour, i.e. they are coupled to markup.
