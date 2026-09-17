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

Automatic retry, 3 attempts *(as built: the base query's own loop, not RTK Query's `retry()` wrapper — see Alternatives)*, exponential backoff
with **full jitter**
(`random(0, min(30s, 1s × 2^n))`). Jitter is not decoration: without it, every merchant whose
connection drops on the same cell tower retries in lockstep and produces a thundering herd the
moment it returns. Retries are suppressed entirely while `navigator.onLine` is false, and
resume on the `online` event rather than burning attempts against a known-dead network.

**Not retried:** `4xx` responses. A `404` will still be a `404` on the third attempt.

### Writes (transfers)

**No automatic retry — enforced for every write by default.** The base query refuses to retry any request
whose type is `mutation`, whatever the endpoint's options say. An earlier version relied on each write endpoint
opting out with `extraOptions: { maxRetries: 0 }`; review showed a new POST endpoint without that line was
sent four times. Making the safe behaviour depend on remembering an opt-out is the wrong default for a payments
app. `sendMoney` keeps `maxRetries: 0` as a second, visible guard, and a test adds an unguarded write endpoint
and asserts it is sent once. A failed transfer surfaces a *Try again* button and the merchant decides. This looks like less engineering and is more judgement: the app must never move money
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

### Implementation status

Built in Phase 3:
- read retries with full jitter (3 retries, a 1s ceiling doubling to a 30s cap), never for a `4xx`;
- **writes never retried**, enforced in the base query by request type;
- a 15s timeout per attempt, and a **30s overall deadline for a read** across all its attempts and backoff.
  Without the deadline the worst case was four 15s timeouts plus backoff: over a minute of spinner for a
  merchant on a poor connection. The last attempt's timeout is shortened to fit the deadline;
- the feed refetched **only its first page** on reconnect (`refetchCachedPages: false`), rather than every page
  the merchant scrolled through *(since replaced: the feed became a paged table, ADR-0016, so each page is its own
  query and only pages on screen refetch)*;
- the reconciliation lookup always goes to the server (`forceRefetch`), never a cached "pending".

Built in Phase 6: reconcile-before-refetch on reconnect (the reconnect guard, ADR-0006).

Built in Phase 7:
- **The connection state** is its own slice ([src/store/connectivitySlice.ts](../../src/store/connectivitySlice.ts)),
  fed by the browser's `online`/`offline` events. Not RTK Query's `config.online`: the reconnect guard holds RTK's
  `onOnline` back while a transfer's outcome is open, so that flag can still say "offline" after the connection returns.
- **No read retries while offline.** The base query stops retrying when the browser reports no connection, before and
  after each backoff wait, and returns the error; `refetchOnReconnect` fetches it again when the connection returns.
  This differs from the text above, which said retries *resume* on the `online` event: the read is fetched again
  rather than the old retry loop waiting, so no request sits in a loop for a network that may not return.
  **Exception, found in review:** while a transfer's outcome is open the reconnect guard holds RTK's `onOnline`, so
  `refetchOnReconnect` does not fire. A read that failed offline would then stay failed until reconciliation ended, up
  to about two minutes. The guard now refetches, at once, any read that failed with **nothing cached** (a page opened
  while offline): it holds no optimistic change to lose. A failed read that **kept its data** — the balance card after
  a refresh failed offline — still waits, and reads "Couldn't refresh · as of 14:32" meanwhile, because refetching it
  is what would drop the kept change. Tested in `src/store/reconnect.test.ts`; removing the refetch, or the
  nothing-cached condition, makes that test fail.
- **The banner** sits in the sticky top bar on every page: "You're offline…" for as long as it lasts, then "You're back
  online" for four seconds. Its live region is mounted from the first render.
- ***Send* is refused offline** in two places: the thunk refuses (so no render timing matters), and the button carries
  `aria-disabled` with the reason beside it. `aria-disabled`, not `disabled`, so a keyboard or screen reader user can
  reach the button and hear why. On a phone the reason sits inside the sticky action bar, where it is seen; placed
  above it, the bar covered it. *Try again* (a write) is refused the same way, and so is *Check status*, which would do
  nothing visible while checking is paused.
- **Age of loaded data:** the balance card reads "Offline · as of 14:32" (the server's `asOf`), and the recent and full
  transaction lists show the same note from the time the page was fetched.
- **Demo caveat:** the mock runs in a service worker, which answers even while the browser is offline. In the demo,
  requests keep working offline; the banner and the refusals follow the browser's status, which is what a real device
  on a dropped network would also report.

**Not built:** an offline write queue (see Alternatives), and a check that the *server* is reachable when the browser
says it is online — `navigator.onLine` true only means some network exists, so failures are still handled where they
happen.

## Alternatives considered

**Retry everything uniformly.** RTK Query's `retry()` wrapper sits on the base query and covers **mutations
as well as queries**: uniform retry is what you get unless every write opts out. Rejected — this is the
configuration that turns one transfer into four. The base query does not use `retry()` at all; its own loop
never retries a mutation.

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
