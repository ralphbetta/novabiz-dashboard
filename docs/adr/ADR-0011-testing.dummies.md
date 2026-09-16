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
5. **Two property tests on the money code** — `parseNairaInput(formatNaira(k)) === k` over
   10,000 random amounts, and "the old-phone fallback agrees with the main path" over 5,000.

### Test 3 is the crown jewel

**Point at it in the interview.** It's the test that fails the moment someone "tidies up" the
reconciliation logic back into the naive snapshot-and-restore — including a future developer
copying the RTK Query docs in good faith. It's how the reasoning in
[ADR-0006](ADR-0006-optimistic-send.dummies.md) survives the next refactor.

### Test 5 already earned its keep

Property tests throw thousands of random values at the money code, catching the edge cases **I
didn't think to enumerate** — by definition, the ones I'd otherwise ship.

This isn't hypothetical. The **fallback-agreement** test (5,000 runs) failed on its first run and
found a real one-kobo bug above ₦10 trillion. Every hand-written case had used small amounts.

**Know which test found it.** The round-trip test couldn't have: on a modern engine it never runs
the fallback code at all. A test only checks the code it actually executes — that's worth saying.

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
