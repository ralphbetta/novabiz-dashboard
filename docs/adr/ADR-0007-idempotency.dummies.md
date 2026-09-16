# ADR-0007 in plain English — Idempotency key

> Plain-language companion to **[ADR-0007](ADR-0007-idempotency.md)**. Same decision, no jargon.
> **Interview weight: ⭐⭐⭐ critical** — explicitly required by the brief.

## The problem

The brief: send an `Idempotency-Key` header "so a retried submit can't double-send".

## What an idempotency key actually is

A unique ID you attach to a request so the server can say: *"I've already seen this one. Here's
the same answer I gave before. I'm not doing it twice."*

## The trap

It's very easy to satisfy this requirement in a way that **does absolutely nothing.**

If you generate the key inside your fetch function, then **every retry gets a new key**. The
server sees two unrelated transfers and pays out twice. The header is present, the code looks
right, the audit trail looks right, and the protection is **zero**.

## What I did

1. Generate the key **once**, when the merchant taps Confirm — before the first request.
2. Store it on the *attempt*, in the Redux draft slice.
3. **Every** retry reuses it — automatic, manual *Try again*, and the reconciliation lookup.
4. Clear it only when the transfer genuinely finishes.
5. Changing the amount or recipient starts a **new** attempt with a **new** key.

> ### The rule
> **New key = "I meant a different transfer."**
> **Same key = "I mean the same one I already told you about."**

## Why not the obvious alternative

**Hash the payload** — recipient + amount + the current minute. Deterministic, no storage
needed, and it sounds elegant.

It breaks on a real case: a merchant legitimately paying the same supplier ₦5,000 twice in one
minute would have the second payment **silently swallowed as a duplicate**. A deduplication
scheme must never make a real transaction impossible.

**Server-issued keys** — ask for a token, then spend it. Some real processors do this. It costs
a round trip before the transfer, which on this audience's connection is a second of latency at
the worst moment. And it doesn't help if *that* request is the one that times out.

## How this connects to ADR-0006

They're one mechanism seen from two sides. The reconciliation in
[ADR-0006](ADR-0006-optimistic-send.dummies.md) works by asking the server *"what happened to
this key?"* — so without a stable key, recovery from the `unknown` state is impossible.

## What it costs me

The key has to be threaded through the draft slice, the mutation, the retry path and the
reconciliation query, and cleared at exactly the right moment. Too early and the double-send
hole reopens; too late and a genuine second payment gets rejected. Both directions have a test.

**Note:** the UI also disables Confirm while the request is in flight. That's a courtesy, not
the protection. The key is the protection — it's what survives the merchant force-closing the
app and reopening it.

## Say this

> "The key belongs to the merchant's intent, not to the HTTP call. Generated per-request, it
> protects against nothing at all."
