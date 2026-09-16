# ADR 0003 — RTK Query owns all server-derived state

**Status:** Accepted · **Date:** 2026-09-16

## Context

Almost every piece of state in this app is a **cached copy of something the server owns**: the
balance, today's totals, the transaction feed, the result of a transfer. Very little of it is
genuinely client-owned.

The two hard requirements — an infinite, filterable feed and an optimistic send that reconciles
on failure — are both cache-coherence problems, not UI problems. Whatever we pick has to have a
real answer for both.

There is also a constraint that is not technical and is not negotiable: **this code will be
explained and modified live, under questioning.** A marginally better library that the author
reasons about more slowly is the worse choice.

## Decision

Use **Redux Toolkit 2.x with RTK Query** as the single owner of all server-derived state. One
API slice, one store, one mental model. No server data is duplicated into a second store.

```ts
export const novabizApi = createApi({
  reducerPath: 'novabizApi',
  baseQuery: retryingBaseQuery,                    // see ADR 0014
  tagTypes: ['Balance', 'Transactions', 'Transfer'],
  endpoints: (build) => ({
    getBalance:      build.query<BalanceResponse, void>({ … }),
    getTransactions: build.infiniteQuery<Page, TxFilters, Cursor>({ … }),
    sendMoney:       build.mutation<TransferResponse, SendMoneyArgs>({ … }),
    getTransferByKey: build.query<TransferResponse, string>({ … }),   // reconciliation, ADR 0006
  }),
});
```

Cache configuration is deliberate, not default:

| Setting | Value | Why |
|---|---|---|
| `keepUnusedDataFor` (feed) | 120s | Returning from the send flow shouldn't refetch |
| `keepUnusedDataFor` (balance) | 30s | Money figures should be fresh |
| `refetchOnMountOrArgChange` (feed) | `false` | Preserves scroll position on a slow connection |
| `refetchOnFocus` | `false` | A merchant switching apps shouldn't lose their place |
| `refetchOnReconnect` | `true` (reads only) | But reconciliation runs first — ADR 0014 |

## Alternatives considered

**TanStack Query + a separate client-state library (Zustand).** The most common answer in 2026,
and a genuinely strong one — `useInfiniteQuery` is more mature than RTK Query's infinite query
support, and the mutation lifecycle is purpose-built for optimistic rollback. It lost on two
counts. First, it means **two state tools and a boundary to police**: every new piece of state
starts with "which one?" RTK Query answers server *and* client state in one store, and the
boundary disappears. Second, and more decisive: Redux is the approach this codebase's author
reasons about fastest, and the assessment explicitly involves defending and modifying this code
live. Fluency is a real engineering property, not a preference.

**Redux Toolkit with hand-written thunks and slices for server data.** This is the Redux many
people picture, and it is the version worth rejecting explicitly: it means hand-writing caching,
request deduplication, pagination, loading/error flags, and optimistic rollback in reducers.
That is a large amount of bespoke code in exactly the area being graded for correctness. RTK
Query exists precisely to delete it.

**SWR.** Minimal and pleasant, with the weakest story of the three for optimistic mutations —
which is the hardest requirement in the brief.

**Plain Context + `useReducer` for everything.** Ruled out in ADR 0004.

## Consequences

*What it buys:*

- **One store, one mental model.** Server cache and client state are the same system, inspected
  with the same tool.
- **Redux DevTools.** This is a larger advantage here than usual. The optimistic-update
  sequence in ADR 0006 — patch applied, request fails, classify, undo *or* reconcile — is an
  ordered series of dispatched actions that can be **stepped through and time-travelled** in
  the DevTools. On interview day that turns the hardest part of the app from an explanation
  into a demonstration.
- **Tag-based invalidation** (`providesTags` / `invalidatesTags`) is declarative, so cache
  relationships live next to the endpoint rather than in scattered imperative calls.
- **Generated, typed hooks** — `useGetBalanceQuery`, `useSendMoneyMutation` — so components
  stay free of fetching mechanics.

*What it costs:*

- **Setup ceremony.** Store, provider, api slice, and typed `useAppDispatch` / `useAppSelector`
  hooks before the first request is made. For four endpoints that is visible overhead, and we
  accept it in exchange for the single mental model.
- **Everything in the store must be serializable.** `Kobo` is a branded number, so it is fine;
  dates are stored as ISO strings and parsed at the edge, never as `Date` objects in state.
- **Invalidation needs discipline.** A broad `invalidatesTags: ['Transactions']` after every
  send would refetch the whole feed on a 3G connection — a user-visible regression. The send
  flow therefore **patches the cache** with `updateQueryData` and invalidates nothing. Tags are
  used for genuine cross-entity relationships only.
- **RTK Query's infinite query support is newer** than TanStack Query's equivalent — see
  ADR 0008 for how we handle that, including the pre-2.8 fallback.

## How we would know we were wrong

- We start writing manual slices that mirror RTK Query cache data to make something work.
- The number of hand-written `updateQueryData` patches outgrows the number of endpoints,
  meaning the cache model is fighting us rather than helping.
- Bundle analysis shows the Redux layer is a meaningful share of a payload we are shipping to
  people on metered data.
