# ADR-0001 in plain English — Application stack

> Plain-language companion to **[ADR-0001](ADR-0001-application-stack.md)**. Same decision, no jargon.
> **Interview weight: ○ low** — unlikely to be challenged, but have the one-liner ready.

## The problem

React app, but which flavour? Next.js is the default everyone reaches for in 2026.

## What I did

Plain **Vite + React 18 + TypeScript**, client-side only. No Next.js, no server-rendering.

## Why not the obvious alternative

Next.js is the fancy default and the wrong one here. Every screen in this app is behind a
login, so server-rendering renders nothing useful — there's no SEO, no public page, no
first-paint content a server could send. On top of that, MSW's browser worker fights with
Next's server runtime, and sorting that out would eat hours that belong to the money code.

## What it costs me

No SSR, no route-level preloading. If NovaBiz ever grew a public marketing page or needed
server-side session handling, I'd revisit this.

## Say this

> "Everything's behind auth, so SSR buys nothing. I'd rather spend the time budget on the
> reconciliation logic than on framework configuration."
