# ADR-0011 in plain English — Testing strategy

> Plain-language companion to **[ADR-0011](ADR-0011-testing.md)**. Same decision, no jargon.
> **Interview weight: ⭐⭐ high** — "tests that would actually catch a regression" is a named criterion.

## The problem

The brief asks for tests that would **"actually catch a regression"** in Send Money.

That phrasing rules out the usual filler. A snapshot test of a balance card catches a whitespace
change and misses a rounding bug. Coverage percentage isn't the target — **the chance a real
defect gets caught before it ships** is.

## What I did

Weight the tests by **what breaks a merchant's money**, not by what's easy to test.

### The five that matter

1. **Happy path** — send ₦1,000.50, balance changes by **exactly 100050 kobo** (checked against
   the mock's ledger, not just the text on screen).
2. **Definite failure** — force a `422`. Row removed, balance restored to the exact prior value.
3. **Timeout on a transfer the server DID record** — row must become "Awaiting confirmation",
   balance must **NOT** be restored, reconciliation resolves it.
4. **Retry doesn't double-send** — force a timeout, tap Try again, assert the ledger has
   **exactly one** entry.
5. **Round-trip property test** — `toKobo(format(k)) === k` for 10,000 random values.

### Test 3 is the crown jewel

**Point at it in the interview.** It's the test that fails the moment someone "tidies up" the
reconciliation logic back into the naive snapshot-and-restore — including a future developer
copying the RTK Query docs in good faith. It's how the reasoning in
[ADR-0006](ADR-0006-optimistic-send.dummies.md) survives the next refactor.

### Test 5 earns its keep

A property test throws 10,000 random values at the money code. It catches the edge cases **I
didn't think to enumerate** — which, by definition, are the ones I'd otherwise ship.

## What I deliberately don't test

- **No snapshot tests.** They fail on whitespace and pass on bugs.
- **No test asserting a `<div>` rendered.**
- **No coverage threshold gate.** It incentivises testing getters. I report coverage; I don't
  enforce it.

## Why not the obvious alternative

**Chasing 90% coverage** — the tests above land around 70–80%. The rest is presentational
markup, where a test costs maintenance and catches nothing.

**Testing against stubbed modules instead of the real MSW handlers** — faster, and it lets a
test pass while the app is broken, because the contract under test is one I invented for the
test.

**Cypress instead of Playwright** — comparable. Playwright won on two specifics I actually
need: multi-viewport projects in one config (360px and 1440px), and real offline emulation.

## What it costs me

The E2E tests need the mock's deterministic override controls to avoid flakiness — which is part
of why the chaos panel in [ADR-0005](ADR-0005-mock-api.dummies.md) exists. And Playwright adds
CI time and browser downloads.

## Say this

> "Coverage percentage would reward me for testing getters. I aimed the tests at the four ways
> this app can actually lose someone's money instead. This one" — point at test 3 — "is the one
> that fails if someone simplifies the reconciliation back to the naive pattern."
