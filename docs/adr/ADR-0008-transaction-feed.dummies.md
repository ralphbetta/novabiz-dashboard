# ADR-0008 in plain English — Transaction feed

> Plain-language companion to **[ADR-0008](ADR-0008-transaction-feed.md)**. Same decision, no jargon.
> **Interview weight: ⭐⭐ high** — "performance at 1,000+ rows" is a named grading criterion.

## The problem

"Must stay smooth with 1,000+ rows loaded", filterable by date, status and type, on a cheap
Android phone.

## The insight — that's two problems, not one

People mash these together and solve half:

| Problem | Symptom | Fix |
|---|---|---|
| Too many rows in the page | Scrolling stutters | **Virtualisation** |
| Downloading 1,200 records over 3G | Long wait before anything appears | **Pagination** |

Do only virtualisation and the merchant waits ages for the first row. Do only pagination and
the page eventually chokes anyway. **I did both, separately.**

## What I did

**Network:** RTK Query's infinite query, cursor-based, 50 rows a page.

**Rendering:** `@tanstack/react-virtual` — only the ~12 rows you can actually see exist in the
page, regardless of how many are loaded. Rows are fixed-height so it doesn't need a measuring
pass.

*(Side note if a panellist spots the name: `@tanstack/react-virtual` is a virtualiser only. Same
maintainer as TanStack Query, no dependency on it. It sits happily alongside RTK Query.)*

**Re-renders:** rows are memoised, the money formatter is created once at module level not per
render, and row callbacks are stable. I profiled it and put the numbers in the README rather
than just claiming it.

## The correctness point hiding in here

**Filtering happens on the server.** If you filter the 50 rows you happen to have downloaded,
you're showing the merchant a *subset* and calling it the answer.

That's a correctness bug wearing a performance costume, and it's worth naming as one.

## The bit most people miss

**Virtualisation breaks screen readers by default.** A screen reader sees 12 rows out of 1,200
and has no idea the rest exist. So:

- the list is a real table with `aria-rowcount` set to the **true total**, and each row carries
  its true index
- a polite live region announces "50 more transactions loaded"
- there's a real **Load more** button, not just a scroll trigger — because a keyboard user
  can't reliably scroll a windowed list to fire the sentinel

That last one is the difference between "passes an automated accessibility scan" and "a
merchant using a screen reader can actually reach transaction 900".

## Why not the obvious alternative

**Offset pagination** (`?page=3`) is simpler and wrong for a live feed — a transfer arriving
while you're on page 3 shifts every row, and you see a duplicate at the page boundary. Cursors
are stable when things get inserted.

**No virtualisation, just 50-per-page** is honestly defensible. I went further because the
brief asks for 1,000+ rows *loaded*, and infinite scroll is the right interaction on a phone.

## What it costs me

Fixed-height rows mean a long description has to truncate rather than wrap. And a virtualised
list can't be searched with the browser's own Ctrl+F — a genuine loss, partly compensated by
the in-app filters.

## Say this

> "Virtualisation fixes the DOM, pagination fixes the network — different problems. And
> filtering is server-side, because client-side filtering of a partial dataset gives the
> merchant a wrong answer."
