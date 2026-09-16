# ADR 0014 — Retry with backoff, but only for operations that are safe to retry

**Status:** Accepted · **Date:** 2026-09-16

## Context

A stretch goal asks for basic offline / poor-connectivity handling with retry and backoff,
reflecting real low-connectivity users.

Retry is not uniformly safe. Automatically retrying a **read** is free. Automatically
retrying a **write that moves money** is how a merchant sends ₦50,000 three times. The
distinction is the whole decision.

## Decision

**Reads retry automatically. Writes do not.**

### Reads (balance, transactions, reconciliation lookups)

Automatic retry via RTK Query's `retry()` base-query wrapper, 3 attempts, exponential backoff
with **full jitter**
(`random(0, min(30s, 1s × 2^n))`). Jitter is not decoration: without it, every merchant whose
connection drops on the same cell tower retries in lockstep and produces a thundering herd the
moment it returns. Retries are suppressed entirely while `navigator.onLine` is false, and
resume on the `online` event rather than burning attempts against a known-dead network.

**Not retried:** `4xx` responses. A `404` will still be a `404` on the third attempt.

### Writes (transfers)

**No automatic retry.** The `retry()` wrapper applies to the whole base query, so the transfer
endpoint opts out explicitly with `extraOptions: { maxRetries: 0 }`. That is a single line that
is easy to delete by accident, so it carries a comment naming this ADR and is asserted by a
test. A failed transfer surfaces a *Try again* button and the merchant decides. This looks like less engineering and is more judgement: the app must never move money
without an explicit human action, and the `unknown` state from ADR 0006 means the app often
does not know whether the first attempt landed.

When the merchant does tap *Try again*, the idempotency key from ADR 0007 is reused, so even a
retry of a request that actually succeeded cannot debit twice. **The safety net is the key, not
the absence of retry** — we have both, because each protects against a case the other does not.

### Offline handling

- An `online` / `offline` listener drives a persistent, announced banner.
- While offline, the *Send* action is **disabled with an explanation**, not silently queued.
  A queued transfer that fires on reconnect, minutes later, against a balance the merchant no
  longer remembers, is a surprising debit. If offline queuing is ever added it needs an
  explicit "send these now?" confirmation on reconnect, and that is a product decision, not a
  technical one.
- Cached feed data stays visible and readable while offline, clearly marked with its age
  ("as of 14:32"). Read-only access to your recent transactions with no connection is a real
  benefit for this audience.
- On reconnect: reconciliation of any `unknown` transfers runs **first**, before any refetch,
  so the merchant learns what happened to their money before the screen refreshes around them.

### Timeouts

A 15s timeout on all requests, via `fetchBaseQuery`'s `timeout` option, which surfaces as
`status: 'TIMEOUT_ERROR'` and is classified as *not* a definite failure in ADR 0006. Without it, a stalled connection produces a
spinner that never ends — the brief's "no unhandled spinners", in its most literal form. An
aborted transfer enters `unknown`, never `failed`.

## Alternatives considered

**Retry everything uniformly.** This deserves emphasis, because RTK Query's `retry()` wrapper
sits on the base query and therefore covers **mutations as well as queries**. Uniform retry is
not something a developer has to switch on here — it is what you get unless you opt out. That
makes the per-endpoint `maxRetries: 0` above load-bearing rather than merely defensive.
Rejected: this is the configuration that turns one transfer into three.

**Offline write queue / background sync.** Genuinely valuable for this audience and out of
scope for the time budget; the surprise-debit problem above means it needs UX design, not just
a service worker. Noted in the README as the first thing to build next.

**No timeout, relying on the browser default.** Browser defaults are minutes long.

## Consequences

*What it buys:* transient failures — the common case on a Nigerian mobile network — recover
invisibly for reads, while money movement stays under human control. Backoff with jitter is
polite to a recovering network.

*What it costs:* a merchant on a bad connection may need to tap *Try again* manually. We
consider that correct: the tap is informed consent, and the idempotency key makes it safe.

## How we would know we were wrong

- Merchants report repeatedly tapping *Try again*, meaning the read/write line is drawn too
  conservatively and a bounded, idempotency-protected auto-retry of the first attempt is worth
  revisiting.
- Retry storms appear in mock logs, meaning jitter is misconfigured.
