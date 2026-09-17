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

`isDefiniteFailure` (`src/lib/errors.ts`) returns `true` **only** when the response body carries
`error.rejected: true`. It reads **the flag, never the status code**. It is the most important
function in the app and has its own unit tests.

`rejected: true` is a promise with a precise meaning, defined and pinned per error code in
`REJECTED_BY_CODE` (`src/api/contracts.ts`): **no transfer exists under this idempotency key, and
none ever will.** With RTK Query's `FetchBaseQueryError` union:

| Error shape | Definite failure? |
|---|---|
| `400 VALIDATION_FAILED` / `422 INSUFFICIENT_FUNDS`, `rejected: true` | **Yes** — roll back |
| `409 IDEMPOTENCY_KEY_REUSED`, `rejected: false` | No — something already exists under the key; look it up |
| `404 NOT_FOUND` (from the lookup), `rejected: false` | No — the original may still be in flight |
| `{ status: 'FETCH_ERROR' }` (network) | No — unknown |
| `{ status: 'TIMEOUT_ERROR' }` | No — unknown |
| `500 INTERNAL_ERROR`, `rejected: false`, or any other `5xx` | No — unknown |
| `{ status: 'PARSING_ERROR' }` | No — the server may have acted |
| `CUSTOM_ERROR` with `REQUEST_NOT_SENT` | **Yes** — the base query refused it before calling fetch; nothing left the device |

The last row is the one certain failure that does not come from the server. If the data service never became
ready, the base query refuses the request without sending it. Treating that as `unknown` would start reconciling
against a service that is not running, for a transfer that provably never left the device. It is produced in
exactly one place, before fetch is called, and must never be produced anywhere a request may have been sent.

A status code alone is not evidence. An earlier draft of this table listed `409` as a definite
failure, but a `409` is only possible *because* a transfer already exists under that key.

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
- **a rejection bound to the key** (e.g. `422 INSUFFICIENT_FUNDS`, `rejected: true`) → conclusive:
  the server processed the key, refused it, and will refuse it forever. Undo and announce.
- **`404` not found** → **not an answer.** Stay `unknown` and keep polling. Never undo on a miss.

### Why a miss is not an answer

An earlier draft of this ADR said a `404` meant "the request never reached the server. It is now safe
to undo." That was wrong, and it was the most dangerous error in the design, because it is exactly
the false "nothing was written" this ADR exists to prevent:

1. The POST is slow. The client times out and enters `unknown`.
2. Reconciliation looks the key up. The POST has not been processed yet, so: `404`.
3. The draft rule rolls back, restores the balance, and — under ADR-0007 — clears the key.
4. The original POST lands and debits. The merchant, told it failed, taps *Try again* with a **new**
   key. They have paid twice.

A server can only prove a negative about a key it has **processed**. So the server binds every
processing outcome to the key — including rejections — and the lookup returns that bound rejection
when there is one. Until then, a miss means "not yet", nothing more.

**When reconciliation gives up** (~2 minutes) the row enters *needs attention*. *Try again* there
**reuses the same key**. That is safe in both cases: if the original eventually landed, the retry
replays it; if it never did, the retry creates the transfer exactly once.

**The mock's idempotency store is durable too.** It is saved to browser storage and restored after a reload (ADR-0005),
so a same-key retry or a reconciliation after a reload finds the original, as a real server's would. (An earlier version
kept it in page memory only, and a reload forgot every key.)

Reconciliation runs in a listener middleware (`createListenerMiddleware`) rather than in a
component, so it survives unmounting — a merchant who navigates away from the send screen must
still have their transfer reconciled. It polls with exponential backoff (1s, 2s, 4s, 8s, capped
at 30s, full jitter), pauses while the tab is hidden or the browser reports offline, and resumes
on reconnect. If it is still unresolved after ~2 minutes, the row settles into a terminal *needs
attention* state with a manual *Check status* action rather than spinning forever — the brief's
"no unhandled spinners" requirement applied to the hardest case.

Putting this in middleware rather than a `useEffect` is deliberate: reconciliation is a property
of the *transfer*, not of any screen that happens to be mounted.

## Implementation notes (Phase 5)

- **Who does what.** `sendMoney.onQueryStarted` patches the cache only: the balance, and every cached first page whose
  filters match. `sendTransfer` (src/store/sendTransfer.ts) owns the attempt: refuses while one is open, records it,
  and maps the answer to accepted, rejected or unknown with `isDefiniteFailure`. `transferTracker` listens to the
  endpoint and follows any accepted transfer until it settles, then marks the attempt if it gives up.
- **Undo only what is still ours.** A patch is undone on a definite failure only if its cache entry has not been
  refetched since; a refetched entry already holds the server's copy, which never included the refused transfer.
- **Rows leave pages they no longer match** when their status changes.
- **Reconnect waits.** `reconnectGuard` holds RTK Query's `onOnline` while an attempt is sending or unknown, and releases
  it when the outcome is known or the merchant starts over. Phase 6 replaces the wait with reconciling first.

## Implementation notes (Phase 6)

- **One loop, two jobs.** `transferTracker` reconciles an `unknown` transfer and follows an accepted one until it
  settles; both ask `getTransferByKey` with full-jitter backoff (1s ceiling doubling to 30s) for about two minutes of
  checking time, paused while offline or hidden.
- **What ends it:** a found transfer, or a rejection bound to the key — read from `error.rejected` on the lookup's own
  error, not `isDefiniteFailure`, which also counts a request refused unsent. A 404 or any other error keeps checking.
- **Taking the change back after reconciliation** removes rows by key and refetches the balance. The Phase 5 undo patches
  are long gone by then, and replaying them onto refetched data would corrupt it.
- **Needs attention** is a flag on an `unknown` attempt, not a fifth status: the outcome is still unknown. *Check status*
  restarts the loop; *Try again* sends the same request with the same key without re-applying the optimistic change.
- **Reconnect:** the tracker sits before `reconnectGuard`, so it sees the held reconnect and checks first; the guard
  releases the refetch once the outcome is known or the attempt needs attention.
- **Row label:** a row whose key belongs to an unknown attempt reads *Awaiting confirmation*, not *Pending*.
- **Across a reload** only the key survives (ADR-0004); the restored attempt has no request, so it can be checked but not
  retried.

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
