# ADR 0016 — A paginated transactions table, with rows per page up to 1,000

**Status:** Accepted · **Date:** 2026-09-17 · **Supersedes:** the infinite-scroll parts of ADR-0008

## Context

ADR-0008 chose an infinite-scroll feed: cursor pages of 50 appended as the merchant scrolls, with a virtualised
list so the DOM stays small. The product owner reviewed the running dashboard and asked for something different:
a full-width transactions table with standard pagination and a way to show more rows per page, as in a banking app.

Two constraints from the brief still apply and must survive the change:

- the transaction list must stay smooth "with 1,000+ rows loaded" — a graded performance criterion;
- list virtualisation is a named stretch goal.

Plain 25-row pages would satisfy the request and quietly lose both.

## Decision

**A paginated table** on its own route, `/dashboard/transactions`:

- **Previous, Next and First page** controls, with "1–25 of 1,200" and "Page 1 of 48".
- **Rows per page: 25, 50, 100, 500 or 1,000.** The API's page limit rises from 100 to 1,000 to allow it.
- **The table body stays virtualised** (`@tanstack/react-virtual`). A 1,000-row page renders about 20 rows in the DOM,
  verified in Chrome, so the brief's "1,000+ rows loaded" is exercised by a real, user-selectable page size.
- **Cursor pagination is unchanged on the server.** Each page is a separate `getTransactionsPage` query keyed by
  filters, page size and cursor; the client keeps the stack of cursors it has visited.
- The dashboard shows only the 6 most recent transactions, with a link to the full table.

### What carries over from ADR-0008

Server-side filtering with filters as the cache key; the `(createdAt, id)` cursor; virtualisation with the true row
count declared (`aria-rowcount`, `aria-rowindex`); every async state (loading, empty, empty-because-filtered, error).

### Accessibility specifics

- Changing page moves focus to the top of the table and announces "Showing 26 to 50 of 1,200 transactions" (tested).
- The footer and the announcement use one function, `pageRange`, built from the rows actually on the page. Transactions
  that arrive mid-walk raise the total without joining the walk, so a page can be short, and there can be more pages
  than the total implies; the page count never falls below "this page, plus one if there is a next page".
- Changing the page size resets to page 1 **without remounting the table**, so the footer holding the focused
  rows-per-page control stays mounted and keyboard focus is kept. An earlier version remounted, focus fell to
  `<body>`, and nothing was announced; both were caught in review and are covered by component tests.
- ADR-0008's "Load more" button is gone: Previous and Next are ordinary buttons, reachable by keyboard.

## Alternatives considered

**Keep infinite scroll.** Still the better interaction on a phone, and what ADR-0008 argued for. Rejected because the
product owner asked for pagination; a take-home is also judged on responding to the people it is built for.

**Numbered page links (1 2 3 … 48).** The familiar banking pattern, and not possible with cursor pagination, which
cannot jump to an arbitrary page. Switching the API to offset pagination would reintroduce the problem ADR-0008
avoided: a transaction arriving while the merchant is on page 3 shifts every row, producing duplicates at page
boundaries. Previous, Next and First keep cursor stability.

**Pages capped at 100 rows, no virtualisation.** Simpler, and it would give up the brief's 1,000+ rows criterion and
the virtualisation stretch goal. Rejected.

## Consequences

*What it buys:* the pattern the merchant expects, the brief's performance criterion kept, and a table whose page size
the merchant controls. Returning to a page already seen is instant, because each page is its own cache entry.

*What it costs:* no jumping to page 20; a merchant looking for an old transaction should use the date filter. A
1,000-row page downloads 1,000 records at once — a real cost on 3G, chosen by the merchant rather than imposed.

*The API limit* is 1,000 per page (`PAGE_LIMIT_MAX`), with tests at 1,000 and 1,001.

## How we would know we were wrong

- Merchants page through many pages to find a transaction instead of filtering: the table needs a search or a jump.
- Large page sizes are slow enough on real low-end devices that 500 and 1,000 should be removed.
