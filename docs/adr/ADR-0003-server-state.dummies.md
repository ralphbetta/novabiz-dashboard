# ADR-0003 in plain English — Server state (RTK Query)

> Plain-language companion to **[ADR-0003](ADR-0003-server-state.md)**. Same decision, no jargon.
> **Interview weight: ⭐⭐ high** — the brief names this choice explicitly and asks you to defend it.

## The problem

Balance, transactions, transfer results — none of these are *mine*. They belong to the server;
my app holds a copy. Managing a copy of someone else's data means caching, refetching, knowing
when it's stale, showing loading and error states, and undoing optimistic changes.

Write all that by hand and you'll get it subtly wrong. And "subtly wrong" is exactly what's
being graded.

## What I did

**Redux Toolkit with RTK Query.** One store, one mental model, for both server data and client
data. I define four endpoints once and it generates typed hooks — `useGetBalanceQuery`,
`useSendMoneyMutation`.

## The distinction to draw immediately

When a panellist hears "Redux" they may picture boilerplate hell — hand-written thunks, actions
and reducers for every fetch. **That's the version I'm *not* doing, and it's worth rejecting out
loud.** Hand-rolling server data in reducers means writing your own caching, deduplication,
pagination and rollback. RTK Query exists specifically to delete that code.

## The reason worth leading with

**Redux DevTools.** Every step of the send flow is a dispatched action: patch applied, request
rejected, error classified, patch undone *or* moved to unknown, then each reconciliation poll.
You can **step through it and time-travel** on a share screen.

That turns the hardest part of the app from something I describe into something I demonstrate.
This was a genuine factor in the choice, not a rationalisation afterwards.

## Why not the obvious alternative

**TanStack Query** was the close call, and I'd concede two things: its infinite-query support is
more mature, and its mutation lifecycle is purpose-built for optimistic rollback.

It lost on two counts. One, it only handles *server* state — I'd need a second library for the
wizard draft, so it's two tools and a boundary to police versus one tool. Two, honestly: Redux
is what I reason about fastest, and I knew I'd be defending and modifying this live. Fluency is
a real engineering property, not a preference.

## What it costs me

Setup ceremony — store, provider, typed hooks — before the first request happens. For four
endpoints that's visible overhead, and I'd name it as the cost.

Also: everything in the store must be serializable, so dates are ISO strings, never `Date`
objects. And invalidation needs discipline — a blanket "refresh transactions" after every send
would re-download the whole feed on 3G, so the send flow *patches* the cache instead.

## Say this

> "Almost all my state is a cached copy of server data, so I used RTK Query rather than
> hand-rolling caching and rollback — that's exactly the code that goes subtly wrong. And
> because everything is a dispatched action, I can show you the rollback happening in DevTools
> rather than talk you through it."
