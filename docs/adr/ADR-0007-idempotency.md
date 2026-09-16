# ADR 0007 — The idempotency key belongs to the transfer attempt, not the request

**Status:** Accepted · **Date:** 2026-09-16

## Context

The brief requires a generated `Idempotency-Key` sent with the request "so a retried submit
can't double-send".

The requirement is easy to satisfy in a way that does nothing. If the key is generated inside
the request function, then every retry generates a **new** key, the server sees two unrelated
transfers, and it debits twice. The header is present, the audit looks correct, and the
protection is zero.

The key only has value if it is **stable across every retry of the same intent**.

## Decision

1. The key is a `crypto.randomUUID()` generated **once**, at the moment the merchant confirms
   on the review step — before the first request is made.
2. It is stored on the **transfer attempt** in the draft store, alongside the amount and
   recipient.
3. Every retry — automatic backoff, the user tapping *Try again*, and every reconciliation
   lookup — reuses that same key.
4. The key is cleared only when the attempt reaches a **terminal** state (`settled` or a
   confirmed `failed`). Changing the amount or the recipient starts a **new** attempt with a
   **new** key, because it is a different intent.
5. The mock server keeps an **idempotency store**: a repeated key returns the **original
   response**, with no second ledger entry.

### The rule in one line

> A new key means "I meant a different transfer." Reusing a key means "I mean the same
> transfer I already told you about."

### Scope of the key

It covers the whole attempt, not the network call. The reconciliation lookup in ADR 0006
queries by this key, which is what makes recovery from `unknown` possible at all. The two
ADRs are one mechanism described from two sides.

## Alternatives considered

**Generate in the fetch wrapper.** The common AI-suggested placement, and it is precisely the
no-op described above.

**Hash the payload (recipient + amount + minute bucket).** Deterministic without storage, and
it breaks on a real case: a merchant legitimately paying the same supplier the same ₦5,000
twice in one minute would have the second payment silently swallowed as a duplicate. A
deduplication scheme must never make a real transaction impossible.

**Server-issued key — request a token, then spend it.** This is what several real payment
processors do, and it is arguably more robust. It costs a round trip before the transfer,
which on this audience's connection is a second of added latency at the worst moment, and it
does not survive the case where *that* request is the one that times out.

## Consequences

*What it buys:* double-send is prevented by construction rather than by a disabled button.
Reconciliation has a handle to query by. The behaviour is directly testable — fire the same
key twice, assert one ledger entry.

*What it costs:* the key must be threaded through the draft store, the mutation, the retry
path, and the reconciliation query, and it must be cleared at exactly the right moment. A key
cleared too early reopens the double-send hole; cleared too late, a genuine second payment to
the same supplier is rejected. Both directions have a test.

*The UI still disables the confirm button while in flight.* That is a courtesy, not the
protection. The protection is the key, and the key is what survives the merchant force-closing
the app and reopening it.

## How we would know we were wrong

- A test that submits the same attempt twice produces two ledger entries in the mock server.
- A merchant reports that a legitimate repeat payment was rejected as a duplicate — the
  failure mode in the opposite direction.
