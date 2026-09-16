# ADR-0006 in plain English — Optimistic send & reconciliation

> Plain-language companion to **[ADR-0006](ADR-0006-optimistic-send.md)**. Same decision, no jargon.
> **Interview weight: ⭐⭐⭐ THE BIG ONE.** The whole assessment is built around this. If you
> rehearse one thing, rehearse this.

## The problem

"Optimistic update" means: the moment the merchant taps Send, show it as sent. Don't make them
wait for the server. Good — on a 3G connection, a four-second spinner is what makes people tap
Send twice.

But then: what if the request fails? Or times out *after* you've already shown "sent"?

## The naive version everyone writes

> Save the old state. Show the transfer as sent. If the request errors, put the old state back.

## Why that's dangerous

It treats **"I got an error"** as **"the transfer didn't happen."** Those are different things.

| What happened | Did the money move? | Naive code does | Correct |
|---|---|---|---|
| `422 invalid account` | **No** — server rejected it | Undo | ✅ Undo |
| `500 server error` | **Maybe** — it may have debited, then crashed | Undo | ❌ **Don't know** |
| Request timed out | **Maybe** — it may have arrived | Undo | ❌ **Don't know** |
| Phone lost signal | **Maybe** | Undo | ❌ **Don't know** |

In three of four cases, the naive code puts the money back on screen and tells the merchant it
failed. **The merchant sends it again. Now they've paid twice.**

> ### The one-liner
> **Not getting a "yes" is not the same as getting a "no".**

## And here it's worse — the naive version *is* the official docs

The RTK Query documentation's optimistic-update example is essentially:

```ts
const patchResult = dispatch(api.util.updateQueryData(...))
try { await queryFulfilled } catch { patchResult.undo() }   // ← the bug
```

That's correct for what it's written for — undoing a failed edit to a blog post title is
harmless. It's wrong for money, because `queryFulfilled` rejects on a timeout exactly the same
way it rejects on a `422`, and a bare `catch` can't tell them apart.

**Say this out loud in the interview.** It shows you didn't just copy the docs. And it's a
sharper point than "the naive pattern is wrong" — the AI wasn't hallucinating, it was correctly
reproducing official guidance that happens to be wrong for this domain.

## What I did

A transfer has **four** states, not two:

```
pending ──► settled    "server said yes"      → replace with the real row
        ──► failed     "server said no"       → undo, tell them
        ──► unknown    "server said nothing"  → DON'T UNDO. Go find out.
```

**`unknown` is the state the naive version doesn't have, and it's the entire answer.**

In `unknown`: the row stays on screen saying **"Awaiting confirmation"**, the balance stays
reduced (assume the worst — that's the safe direction for the merchant), and a banner says
*"We couldn't confirm this. We're checking — don't send it again."*

The branch lives in one place, and it's the most important line in the app:

```ts
catch (error) {
  if (isDefiniteFailure(error)) {
    patches.forEach(p => p.undo());   // ONLY here is undo correct
    return;
  }
  // timeout / network error / 5xx — we don't know. Keep the patch.
  dispatch(startReconciliation(args.idempotencyKey));
}
```

`isDefiniteFailure` returns `true` **only** when the server affirmatively told us nothing was
written. A `500` isn't definite. A response we couldn't even parse isn't definite — the server
may have acted and then returned something odd.

## Then: how do we find out?

Because every attempt carries an idempotency key (see [ADR-0007](ADR-0007-idempotency.dummies.md)),
we just **ask the server what happened to that key**:

- **found, succeeded** → mark it settled
- **found, failed** → now it's safe to undo
- **"I refused this key"** (e.g. insufficient funds) → safe to undo. The server remembers the refusal
  forever, so it can't turn into a success later.
- **404, "haven't seen it"** → **NOT safe to undo.** Keep waiting.

### The mistake that was in the first version — know this story

The first version of this ADR said a 404 meant *"the request never arrived — safe to undo."* It
sounds obviously right. It's wrong, and it was caught in review:

1. The merchant's request is slow. The app times out and starts checking.
2. The app asks "what happened to this key?" The slow request hasn't been processed yet → **404**.
3. The old rule says undo. The balance goes back up. The key gets thrown away.
4. The slow request finally lands and takes the money. The merchant, told it failed, sends it again
   with a new key. **Paid twice.**

**The server can only say "no" about a key it has actually processed.** "I haven't seen it" just
means "not yet". So the server now remembers every outcome, rejections included, and only a
remembered rejection counts as a real "no".

If checking gives up after ~2 minutes, *Try again* uses the **same** key. If the slow request did land,
the retry just returns it; if it didn't, the retry sends it exactly once.

**Say this if asked:** *"A missing record isn't evidence of absence while a request can still be in
flight. The server only makes negative promises about keys it has processed, and it binds rejections
to the key so they can't later become successes."*

It polls with backoff (1s, 2s, 4s, 8s), pauses when you're offline, and after ~2 minutes stops
and gives the merchant a *Check status* button rather than spinning forever.

**It runs in Redux listener middleware, not a `useEffect`** — because reconciliation belongs to
the *transfer*, not to whatever screen happens to be open. A merchant who navigates away
mid-transfer must still get an answer.

## What it costs me

Real complexity — a state machine, a polling loop, and a classifier that has to stay correct.
It's the most intricate code in the project and deliberately the most heavily tested.

And a user-facing cost: in `unknown`, the merchant sees an unresolved transfer and a reduced
balance. That's less comfortable than a clean rollback. **It's also true, and the alternative is
a comfortable lie.**

## Say this

> "Absence of a success response isn't evidence of failure. A `422` means nothing was written,
> so I roll back. A timeout means I *don't know* — so I hold the pessimistic view, tell the
> merchant honestly not to resend, and reconcile against the server using the idempotency key.
> Rolling back on a timeout would be telling a merchant their money is safe when it might
> already be gone."
