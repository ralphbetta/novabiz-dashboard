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

- **Where:** `e2e/send-money.spec.ts` and `e2e/support.ts`; `playwright.config.ts` runs a fresh production build through
  `vite preview` (never a server left running, which would test old code), with a `desktop` (1440×900) and a `mobile`
  (360×800, touch) project, and no retries. Each test has a fresh browser context, so a mock starting from the seed.
  9 tests × 2 sizes = 18 runs: 16 pass, 2 skipped by design (flow 4 on mobile, the drawer test on desktop).
- **Two kinds of money assertion.** The mock's ledger (fetched in the page, by idempotency key, in kobo) proves what the
  server recorded; the server's available balance moving by exactly one amount proves no second transfer under *any* key.
  Where the app changes money optimistically, the test also reads the **balance shown on screen**
  (`data-testid="available-balance"`), because the server's figure cannot show the app putting its own display back.
- **Failures are forced through the Mock API panel or `window.novabizChaos`.** Flow 3 uses the panel. To see an unknown
  outcome before reconciliation resolves it (about a second after the 15s timeout), tests raise the mock's latency once
  the POST is on its way — and reset it only after looking, because a reset can reach the mock before it handles the POST.
- **Flow 2 needs a real `422`.** The form will not send more than the balance it shows, so the test spends almost all of
  it with a transfer made outside the app. Its balance check accepts either the restored figure or a fresh one from the
  server, and rejects only a figure reduced by the refused amount, so a future refetch-after-refusal does not break it.
- **Flow 4 runs at desktop size only** with a 5-minute limit: *Try again* appears only after real reconciliation gives up.
  The same rules are covered in milliseconds by store tests with shortened timings.
- **Flow 5 and the mock's service worker:** Playwright's offline mode does not stop a service-worker mock from answering,
  so the test asserts no reconciliation checks during 5 seconds offline. Without pausing, checks would come within that
  window by construction — the first gap is under 1s and the next under 2s — not merely by chance.

### Broken on purpose (desktop runs, recorded)

Each change was made to the app, the named test run against a fresh build, and the change reverted.

| Change to the app | Test | Result |
|---|---|---|
| Roll back on every error (the naive pattern) | 3 | Failed: the "confirming" receipt never appears |
| Keep the row after a timeout but put the shown balance back | 3 | Failed: shown balance 935,972,449 kobo, expected 935,872,399. *The earlier version of this test passed this change.* |
| No optimistic row | 1 | Failed: no *Pending* row. *The earlier version passed this change.* |
| Do not undo after a refusal | 2 | Failed: the refused row is still on the page |
| Do not pause checks while offline | 5 | Failed: the transfer resolved while offline, so the receipt changed |
| A silent second send under a new key after a timeout | 5 | Failed: server balance moved twice |
| — same change | reload flow 7 | **Passed.** The reload cancels the second send before the slowed mock handles it. Flow 5 is the guard for this. |
| Do not restore the mock's saved data | 6 and 7 | Both failed |
| A new key on *Try again* (run in Phase 8's first pass) | 4 | Failed: the two POSTs carried different keys |

- **Browser:** Playwright's Chromium, or `PLAYWRIGHT_CHANNEL=chrome` for an installed Chrome. Playwright's download stalled
  on this network, so these runs used the installed Chrome.

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
