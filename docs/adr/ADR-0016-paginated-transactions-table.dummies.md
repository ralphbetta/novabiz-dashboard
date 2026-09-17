# ADR-0016 in plain English — The paginated transactions table

> Plain-language companion to **[ADR-0016](ADR-0016-paginated-transactions-table.md)**. Same decision, no jargon.
> **Interview weight: ⭐⭐ high** — the brief grades performance with 1,000+ rows, and this is where that lives.

## What changed

The first design ([ADR-0008](ADR-0008-transaction-feed.dummies.md)) was an **infinite scroll** feed: keep scrolling and
more transactions load. After seeing it running, the product owner asked for a **normal banking table**: full width,
with pages, and a choice of how many rows to show.

## What I did

- A table on its own page, `/dashboard/transactions`, with **Previous**, **Next** and **First page**, and "1–25 of 1,200".
- **Rows per page: 25, 50, 100, 500 or 1,000.**
- The dashboard itself shows just the 6 latest transactions, with "View all".

## The bit worth saying out loud

A plain 25-rows-per-page table would have quietly dropped two things the brief asks for: staying smooth with
**1,000+ rows loaded**, and **virtualisation** (a stretch goal). So the rows-per-page menu goes up to **1,000**, and the
table still only draws the rows you can see. Pick 1,000 and there are about **20 rows in the page**, not 1,000. I checked
that in Chrome.

So the change gave the product owner what they asked for **and** kept the brief's requirements.

## Why not numbered pages (1 2 3 … 48)?

Because the server hands out pages with a **cursor** — "give me the page after this transaction" — not "give me page
20". Cursors don't break when new transactions arrive mid-browse. Page numbers do: a new payment shifts every row, and
you see the same transaction twice across a page boundary. So: Previous, Next and First, and use the date filter to find
something old.

## An accessibility detail that bit us

Changing "Rows per page" used to rebuild the whole table. The dropdown you'd just used disappeared, so keyboard focus
jumped to the top of the page, and screen readers heard nothing. Now the table stays put and just goes back to page 1:
focus stays on the dropdown, and "Showing 1 to 50 of 1,200 transactions" is announced. Review caught it; tests guard it.

## Say this

> "The product owner asked for pagination, so I built it — but with a rows-per-page option up to a thousand, and the table
> body still virtualised. That keeps the brief's 1,000-rows performance requirement real instead of quietly losing it."
