# ADR 0006 — Optimistic send reconciles against the server, and never guesses on timeout

**Status:** Accepted · **Date:** 2026-09-16

## Context

The brief requires an optimistic UI update on send, and requires that it "reconcile correctly if
the mocked network request fails **or times out** after the UI has already shown *sent*".

Those two words are doing a lot of work, and they separate a correct implementation from a
plausible-looking one.

Consider what the client actually knows in each case:

| What happened | What the client knows | Correct response |
|---|---|---|
| `400` / `422` validation error | The transfer **definitely did not happen** | Roll back fully |
| `500` after the server wrote the ledger | **Unknown** — possibly debited | Do not roll back; verify |
| Request times out | **Unknown** — the request may have arrived | Do not roll back; verify |
| Browser goes offline mid-flight | **Unknown** | Do not roll back; verify |

The naive pattern treats all four rows identically: apply a patch, undo it on any error. That is
**wrong in three of the four rows**, and wrong in the worst possible direction for a payments
app: it tells a merchant their money is safe when it may already be gone. A merchant who sees
the transfer vanish will send it again. Now they have paid twice.

**Absence of a success response is not evidence of failure.**

### Why this is a trap specifically in RTK Query

The pattern is not just what an AI assistant suggests first — it is, almost verbatim, the
optimistic-update example in the RTK Query documentation:

```ts
async onQueryStarted(arg, { dispatch, queryFulfilled }) {
  const patchResult = dispatch(api.util.updateQueryData(…));
  try { await queryFulfilled } catch { patchResult.undo() }   // ← wrong for money
}
```

That example is fine for the case it is written for — toggling a post's title, where undoing a
failed edit is harmless. It is wrong here, because `queryFulfilled` rejects on timeouts and
network errors as readily as on a `422`, and `catch` cannot tell them apart. The bare `catch` is
the entire bug.

Anyone who copies the documented pattern into this app has introduced a money-losing defect
while following official guidance. That is worth stating plainly, because it is the most likely
way this regresses later.

## Decision

Model a transfer as a **four-state machine**, not a boolean:

```
                   ┌──────────────► settled   (server confirmed success)
                   │
draft ──► pending ─┼──────────────► failed    (server confirmed failure — safe to roll back)
                   │
                   └──────────────► unknown   (no answer — verify, never assume)
                                       │
                                       └──► resolves to settled or failed on reconciliation
```

`unknown` is the state the naive pattern does not have, and it is the entire point.

### What the UI does in each state

- **pending** — the row appears immediately at the top of the feed with a `pending` badge, and
  the balance shows an *available* figure reduced by the amount. The optimistic update is real;
  the merchant sees their money move.
- **settled** — the optimistic row is replaced by the server's canonical row, matched by
  idempotency key. The balance is patched with the server's authoritative figure.
- **failed** — the patch is undone, the balance returns to its prior value, and an assertive
  live region announces the failure with the reason.
- **unknown** — **the patch is NOT undone.** The row stays, relabelled *Awaiting confirmation*.
  The balance stays reduced, because the pessimistic reading is the safe one for the merchant.
  A banner says plainly: *"We could not confirm this transfer. We are checking — do not send it
  again."* Reconciliation begins.

### The implementation

The whole decision lives in one `onQueryStarted`, and the branch is the load-bearing line:

```ts
sendMoney: build.mutation<TransferResponse, SendMoneyArgs>({
  query: (args) => ({
    url: '/transfers',
    method: 'POST',
    headers: { 'Idempotency-Key': args.idempotencyKey },   // ADR 0007
    body: args,
  }),
  extraOptions: { maxRetries: 0 },                          // never auto-retry money — ADR 0014
  invalidatesTags: [],                                      // patch, don't refetch — ADR 0003

  async onQueryStarted(args, { dispatch, queryFulfilled }) {
    const patches = [
      dispatch(novabizApi.util.updateQueryData('getBalance', undefined, (draft) => {
        draft.balanceKobo = subtractKobo(draft.balanceKobo, args.amountKobo);
      })),
      dispatch(novabizApi.util.updateQueryData('getTransactions', args.filters, (draft) => {
        draft.pages[0].items.unshift(optimisticRow(args));
      })),
    ];

    dispatch(transferDraft.actions.attemptStarted({ key: args.idempotencyKey }));

    try {
      const { data } = await queryFulfilled;
      patches.forEach(p => p.undo());                       // drop the optimistic row…
      dispatch(applyCanonicalTransfer(data));               // …and apply the server's truth
      dispatch(transferDraft.actions.settled(data));
    } catch (error) {
      if (isDefiniteFailure(error)) {
        patches.forEach(p => p.undo());                     // ONLY here is undo correct
        dispatch(transferDraft.actions.failed(reasonOf(error)));
        announce('assertive', `Transfer failed: ${reasonOf(error)}`);
        return;
      }
      // timeout, network error, 5xx — we do not know. Keep the patch.
      dispatch(transferDraft.actions.unknown({ key: args.idempotencyKey }));
      announce('assertive', 'We could not confirm this transfer. Do not send it again.');
      dispatch(startReconciliation(args.idempotencyKey));
    }
  },
}),
```

`isDefiniteFailure` (`src/lib/errors.ts`) returns `true` **only** for responses where the server
has affirmatively told us nothing was written. It is the most important function in the app and
has its own unit tests. With RTK Query's `FetchBaseQueryError` union, the shapes are:

| Error shape | Definite failure? |
|---|---|
| `{ status: 400\|409\|422, data: { rejected: true } }` | **Yes** — roll back |
| `{ status: 'FETCH_ERROR' }` (network) | No — unknown |
| `{ status: 'TIMEOUT_ERROR' }` | No — unknown |
| `{ status: 500…599 }` | No — unknown |
| `{ status: 'PARSING_ERROR' }` | No — the server may have acted |

Note the last row: a response we could not parse is **not** a failure. The server may have
processed the transfer and returned something unexpected.

### Reconciliation

Because every attempt carries a stable idempotency key (ADR 0007), the client can simply **ask
the server what happened to that key**:

```
GET /transfers?idempotencyKey=<key>      →  getTransferByKey
```

- **found, successful** → transition to `settled`, patch the cache with the canonical row.
- **found, failed** → transition to `failed`, undo the patch, announce it.
- **404 not found** → the request never reached the server. It is now safe to undo, and safe to
  offer *Try again* — which reuses the same key, so even a request that was in flight all along
  cannot produce a second debit.

Reconciliation runs in a listener middleware (`createListenerMiddleware`) rather than in a
component, so it survives unmounting — a merchant who navigates away from the send screen must
still have their transfer reconciled. It polls with exponential backoff (1s, 2s, 4s, 8s, capped
at 30s, full jitter), pauses while the tab is hidden or the browser reports offline, and resumes
on reconnect. If it is still unresolved after ~2 minutes, the row settles into a terminal *needs
attention* state with a manual *Check status* action rather than spinning forever — the brief's
"no unhandled spinners" requirement applied to the hardest case.

Putting this in middleware rather than a `useEffect` is deliberate: reconciliation is a property
of the *transfer*, not of any screen that happens to be mounted.

## Alternatives considered

**`try { await queryFulfilled } catch { patchResult.undo() }`.** The documented pattern.
Rejected above, at length, because it is the thing most likely to be reintroduced.

**No optimistic update at all — a spinner until the server answers.** Genuinely the safest
option, and what a conservative bank might ship. Rejected because the brief requires an
optimistic update, and because on a 3G connection a four-second spinner after tapping *Send* is
exactly the uncertainty that makes merchants tap twice.

**Optimistic update, then `invalidatesTags: ['Balance', 'Transactions']` on settle.** Simple and
correct, and on a poor connection it means re-downloading a page of transactions to learn one
fact. We patch with the server's canonical row and refetch only if the patch cannot be applied.

**Holding the pending transfer in a slice instead of patching the RTK Query cache.** Would mean
the feed component merges two sources — cache plus pending — at render time. Workable, and it
puts the "is this row real?" question into every consumer. Patching the cache keeps one source
of truth for what the feed shows.

## Consequences

*What it buys:* the app never tells a merchant their money is safe when it might not be, and
never tells them a transfer failed when it may have succeeded. Combined with ADR 0007, a retry
cannot double-send.

*A specific benefit of the Redux choice:* every step — patch applied, request rejected,
classification, undo *or* `unknown`, each reconciliation poll — is a dispatched action in the
Redux DevTools timeline. The hardest behaviour in the app can be **stepped through and
time-travelled** on a share screen rather than described. This was a real factor in ADR 0003.

*What it costs:* genuine complexity — a state machine, a middleware-driven reconciliation loop,
and a classifier that must stay correct as error shapes change. This is the most intricate code
in the project and is deliberately the most heavily tested (ADR 0011).

*A user-facing cost:* in the `unknown` state the merchant sees an unresolved transfer and a
reduced balance. That is less comfortable than a clean rollback. It is also true, and the
alternative is a comfortable lie.

## How we would know we were wrong

- A test that forces a timeout on a transfer the mock server *did* record ends with the balance
  restored and the row gone. That is the bug this ADR exists to prevent, and it is an E2E test,
  not a hypothetical.
- Reconciliation polling shows up as a battery or data cost in real usage — at which point
  server push (WebSocket / SSE) replaces polling, and this ADR is superseded in part.
