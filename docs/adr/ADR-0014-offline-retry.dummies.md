# ADR-0014 in plain English — Offline & retry

> Plain-language companion to **[ADR-0014](ADR-0014-offline-retry.md)**. Same decision, no jargon.
> **Interview weight: ⭐ medium** — but the RTK Query gotcha below is worth knowing cold.

## The problem

A stretch goal asks for offline and poor-connectivity handling with retry and backoff, for real
low-connectivity users.

## The insight

**Retry is not uniformly safe.**

Retrying a page load is free. Retrying "send ₦50,000" three times is a disaster. That
distinction is the whole decision.

## What I did

> **Reads retry automatically. Writes do not.**

**Reads** (balance, transactions, reconciliation lookups): 3 attempts, exponential backoff.
Suppressed entirely while the browser reports offline — no point burning attempts against a
known-dead network — and resumed on reconnect.

**Writes** (transfers): no automatic retry. A failed transfer shows a *Try again* button and a
human decides. This looks like *less* engineering and is actually judgement: the app must never
move money without an explicit human action, especially since after a timeout it often doesn't
know whether the first attempt landed.

## The RTK Query gotcha — know this one

RTK Query's `retry()` wrapper sits on the **base query**, so it covers **mutations as well as
queries** by default.

**Uniform retry isn't something you switch on here — it's what you get unless you opt out.**

So the transfer endpoint carries an explicit `extraOptions: { maxRetries: 0 }`. That's one line.
Deleting it by accident auto-retries payments. It has a comment naming the ADR and a test
asserting it.

## Why jitter isn't decoration

Backoff is 1s, 2s, 4s — **plus a random amount**.

Without the randomness, every merchant on the same cell tower retries in perfect lockstep the
instant signal returns, and they all hammer the server together. That's a thundering herd, and
jitter is the standard fix.

## Offline behaviour

- A banner appears, and it's announced, not just shown.
- **Send is disabled with an explanation**, not silently queued. A transfer that fires by itself
  ten minutes later, against a balance the merchant no longer remembers, is a nasty surprise.
- Cached transactions **stay readable**, labelled with their age ("as of 14:32"). Being able to
  check your recent transactions with no signal is a real benefit for this audience.
- On reconnect, **reconciliation runs first**, before any refetch — so the merchant finds out
  what happened to their money before the screen changes around them.

## Why not the obvious alternative

**An offline write queue** would be genuinely valuable for this audience, and it's out of scope
for the time budget. The surprise-debit problem above means it needs UX design, not just a
service worker — it'd need an explicit "send these now?" confirmation on reconnect. It's named
in the README as the first thing I'd build next.

## What it costs me

A merchant on a bad connection may have to tap *Try again* manually. That's correct: the tap is
informed consent, and the idempotency key makes it safe.

## Say this

> "Reads retry, writes don't — and in RTK Query that needs an explicit opt-out, because the
> retry wrapper covers mutations too. Plus the idempotency key means that when the merchant
> *does* tap Try again, it's still safe. Belt and braces, because each covers a case the other
> doesn't."
