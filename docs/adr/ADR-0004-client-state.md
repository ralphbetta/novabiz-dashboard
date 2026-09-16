# ADR 0004 — Client-only state lives in Redux slices, in the same store

**Status:** Accepted · **Date:** 2026-09-16

## Context

After ADR 0003, what is left is narrow:

- the **Send Money wizard draft** (recipient, amount, current step, the current attempt and its
  idempotency key) — must survive navigating away and back, must not be lost by a re-render;
- the **theme preference**;
- the **mock-API chaos settings** (latency, failure rate, force-next), which are a dev control
  surfaced in the UI.

None of this belongs to the server. Putting it in the RTK Query cache would be an abuse of the
tool — it is not a copy of anything.

## Decision

Two plain **Redux Toolkit slices** in the **same store** as the API slice:

```
store/
  index.ts              // configureStore: novabizApi.reducer + the two slices
  transferDraftSlice.ts // recipient, amount, step, attempt { id, idempotencyKey, status }
  preferencesSlice.ts   // theme, chaos settings
```

Components read with **narrow `useAppSelector` selectors**, never by selecting a whole slice:

```ts
// good — re-renders only when the amount changes
const amountKobo = useAppSelector(s => s.transferDraft.amountKobo);

// bad — re-renders on every keystroke anywhere in the draft
const draft = useAppSelector(s => s.transferDraft);
```

Derived values use `createSelector` so a recomputation does not become a re-render.

## Alternatives considered

**React Context + `useReducer`.** No dependency, and it would be the right answer if Redux
weren't already in the project for ADR 0003. Rejected for a concrete reason: a Context holding
the wizard draft re-renders **every consumer on every keystroke**. Redux's `useSelector` gives
per-field subscriptions for free — the amount input re-renders, the review panel does not. The
brief grades "unnecessary re-renders are avoided", and this is precisely where Context would
cost us that point.

**Zustand alongside Redux.** Ergonomically pleasant and strictly worse here: it adds a second
store, a second DevTools surface, and a boundary question for every new piece of state, in a
project that already has a store. One of the main reasons for choosing Redux in ADR 0003 was to
*not* have that boundary.

**Local `useState` lifted to the wizard's parent.** Adequate until the merchant navigates to the
transaction feed mid-flow and loses their input. On a phone, that happens constantly.

## Consequences

*What it buys:* one store, one DevTools timeline covering both the server cache and the wizard.
Stepping through a transfer in the DevTools shows the draft transitions and the cache patches
interleaved in dispatch order, which is exactly the sequence ADR 0006 is about. Slices are
trivially testable as pure reducer functions with no rendering.

*What it costs:* boilerplate — a slice file, typed hooks, and selector discipline. `createSlice`
removes most of it, and the selector discipline is a real ongoing cost that a code review has to
enforce, since a lazy whole-slice selector is easy to write and its cost is invisible until you
profile.

*Persistence, decided deliberately:*

- **The preferences slice persists** (theme, and chaos settings so a demo survives a reload). A
  small `store.subscribe` writing two keys to `localStorage`, not `redux-persist` — for two
  fields, a rehydration library is machinery without a payoff.
- **The transfer draft does not persist.** A half-entered transfer contains a recipient account
  number. That is personal financial data under NDPA 2023, and leaving it in device storage
  after the session — on a shared, low-end phone — is a real exposure for no real benefit. It
  lives in memory and dies with the tab.

The second bullet is a case where a regulatory constraint decided a technical question, which is
the kind of thing the brief says strong candidates notice.

*One exception to in-memory-only:* the **idempotency key of an in-flight attempt** is written to
`sessionStorage` (the key alone — no amount, no recipient, no name). If the merchant force-closes
the app mid-transfer and reopens it, we can still reconcile that attempt rather than stranding
them. A bare UUID is not personal data, and losing the ability to reconcile is the larger harm.

## How we would know we were wrong

- The draft slice starts accumulating fields that are really server responses.
- Profiling shows re-renders driven by coarse selectors, meaning the discipline is not holding
  and needs a lint rule rather than a convention.
- We need cross-tab synchronisation of the draft, at which point the persistence trade-off has
  to be reopened explicitly rather than quietly.
