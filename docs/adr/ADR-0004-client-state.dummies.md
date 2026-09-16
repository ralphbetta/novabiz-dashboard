# ADR-0004 in plain English — Client state (Redux slices)

> Plain-language companion to **[ADR-0004](ADR-0004-client-state.md)**. Same decision, no jargon.
> **Interview weight: ⭐ medium** — but the privacy detail below is a strong unprompted point.

## The problem

After ADR-0003, only three things aren't the server's: the half-filled Send Money form, the
dark-mode setting, and the mock API's failure-rate slider. Where do those live?

## What I did

Two plain Redux slices, in the **same store** as the API. No second library.

## Why not the obvious alternative

**React Context** is the no-dependency answer, and it has a specific flaw here: with Context,
every keystroke in the amount field re-renders *everything* reading that context. Redux's
`useSelector` subscribes to just the field you ask for — the amount input re-renders, the
review panel doesn't.

The brief grades "unnecessary re-renders are avoided". This is exactly where Context would
cost that point.

**Zustand** is pleasant and would be strictly worse here — a second store, a second DevTools
surface, and a "which one does this go in?" question for every new piece of state. Avoiding
that boundary was a main reason for picking Redux in the first place.

## The discipline this needs — mention it unprompted

```ts
useAppSelector(s => s.transferDraft.amountKobo)  // ✅ re-renders when the amount changes
useAppSelector(s => s.transferDraft)             // ❌ re-renders on every keystroke
```

Those two lines look identical in code review. Naming the failure mode of your own choice is a
good signal.

## The detail worth volunteering

The half-filled transfer form is **deliberately not saved** to `localStorage`, even though it's
one line to do it. It contains someone's account number — personal financial data under NDPA
2023. On a shared low-end phone, leaving that on disk after the session is a real exposure for
no real benefit. Dark mode persists. Account numbers don't.

One exception: the bare **idempotency key** goes to `sessionStorage` — just the UUID, no amount,
no name. A random UUID isn't personal data, and being unable to reconcile after the merchant
force-closes the app is the bigger harm.

## What it costs me

Boilerplate (a slice file, typed hooks) and ongoing selector discipline that code review has to
enforce, because a lazy selector's cost is invisible until you profile.

## Say this

> "One store for both server cache and client state, so there's never a question about where
> something goes. And a privacy constraint decided what persists, not convenience."
