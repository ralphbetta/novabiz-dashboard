# ADR 0008 — Windowed rendering with a cursor-paginated infinite feed

**Status:** Partly superseded by [ADR-0016](ADR-0016-paginated-transactions-table.md) · **Date:** 2026-09-16

> **Superseded in part.** The infinite-scroll feed, its "Load more" button and its 50-row pages were replaced by a
> paginated table at the product owner's request (ADR-0016). Still in force from this ADR: server-side filtering with
> filters as the cache key, the `(createdAt, id)` cursor, virtualisation, and the accessibility of a virtualised list.
> The text below is left as written at the time, per this index's rule for reversed decisions.

## Context

The feed must hold 1,000+ rows and stay smooth, on a low-end Android phone, while supporting
filters by date range, status and type.

Two separate problems hide in that sentence, and conflating them is the usual mistake:

1. **How many rows exist in the DOM** — a rendering problem, solved by virtualisation.
2. **How many rows are fetched and when** — a network problem, solved by pagination.

Solving only the first still means downloading 1,200 records over 3G before the first row
paints. Solving only the second still means 1,200 DOM nodes once the merchant has scrolled.

## Decision

Solve both, separately.

**Network:** RTK Query's `build.infiniteQuery` (RTK 2.8+) with **cursor-based** pagination, 50
rows per page, and `getNextPageParam` reading the server's `nextCursor`. The filter object is
the endpoint's cache argument, so changing a filter produces a **separate cache entry** rather
than a client-side re-filter of a partial dataset.

That is a correctness point, not a performance one: filtering the 50 rows you happen to have
fetched shows the merchant a subset and calls it the answer. Filtering is therefore
**server-side**, always.

**Rendering:** `@tanstack/react-virtual` windowing the loaded rows, so DOM node count stays
proportional to viewport height rather than to dataset size. Rows are fixed-height (`72px`
mobile, `56px` desktop) so the virtualiser needs no measurement pass.

**Re-render discipline:** the row component is `memo`'d with an explicit comparator; the
formatter from ADR 0002 is module-level, not recreated per render; row callbacks are stable.
Verified with React DevTools Profiler, and the result is noted in the README rather than
asserted.

### Accessibility of a virtualised list

Windowing breaks assistive technology by default — a screen reader sees 12 of 1,200 rows with
no indication that more exist. Mitigations:

- the list is a semantic table with `aria-rowcount` set to the **total**, and each row carries
  its true `aria-rowindex`;
- a polite live region announces "50 more transactions loaded" as pages arrive;
- the sentinel that triggers the next page is accompanied by a real *Load more* button, so
  loading more never requires scrolling, which a keyboard user in a windowed list cannot
  reliably do.

The third point is the one most virtualised feeds get wrong, and it is the difference between
"passes an automated axe scan" and "a merchant using a screen reader can reach transaction
900".

## Alternatives considered

**`react-window`.** Named in the brief and entirely adequate. `@tanstack/react-virtual` was
chosen for a headless API that lets us keep real semantic table markup — `react-window` wants
to own the container element, which makes the `aria-rowindex` story harder. This is the
virtualiser only: it is independent of the data layer and pulls in no TanStack Query.

**Manual accumulation via `serializeQueryArgs` + `merge` + `forceRefetch`.** The pre-2.8 RTK
Query recipe for infinite lists: collapse every page into one cache entry keyed by the filters,
and append on fetch. It works, and it makes the cursor bookkeeping ours to maintain. We hold it
as a **fallback** if the project ends up pinned below RTK 2.8, and record it here so that
fallback is a known position rather than a surprise.

**Offset pagination (`?page=3`).** Simpler, and wrong for a feed with live inserts. A transfer
arriving while the merchant is on page 3 shifts every subsequent row, and they see a duplicate
at the page boundary. Cursors are stable under insertion.

**No virtualisation, just pagination with a page size of 50.** Honestly defensible — 1,200
rows across 24 pages never puts more than 50 in the DOM. Rejected because the brief asks for
1,000+ rows *loaded*, and because infinite scroll is the right interaction on a phone.

**Fetch everything, filter and page on the client.** Simplest code, worst network profile,
and it makes the loading state a 1,200-record wait. Rejected on the audience.

## Consequences

*What it buys:* constant DOM size, constant scroll cost, a first page that arrives over a slow
connection in a reasonable time, and filters that are correct rather than partial.

*What it costs:* fixed-height rows constrain the design — a long transaction description has
to truncate rather than wrap to three lines. Virtualised lists also cannot be searched with
the browser's own Ctrl+F, which is a genuine usability loss we accept in exchange for the
performance, and which the in-app filters partly compensate for.

## How we would know we were wrong

- Profiling shows scroll cost is dominated by something other than DOM size, making the
  virtualiser's complexity unearned.
- Merchants need multi-line descriptions badly enough that variable-height rows and dynamic
  measurement become worth it.
