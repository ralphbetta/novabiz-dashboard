# ADR 0001 — Vite + React 19 + TypeScript as the application shell

**Status:** Accepted · **Date:** 2026-09-16

## Context

The brief asks for a React + TypeScript web app that runs with a single command and has no
real backend. There is no server-rendering requirement, no SEO requirement, and no routing
beyond a handful of views. The app is a signed-in dashboard: every byte it renders is
private to one merchant.

The dominant non-functional constraint is not build sophistication — it is that the app has
to be quick on a low-end Android phone on a poor connection.

## Decision

Use **Vite 8 + React 19 + TypeScript 6 in `strict` mode**, as a pure client-side SPA. No
Next.js, no SSR, no meta-framework.

The scaffold enables the **React Compiler**, which auto-memoises. That changes ADR-0008's
re-render story: manual `memo` / `useMemo` on feed rows is largely redundant, so we profile
first and only hand-memoise where the compiler demonstrably bails out — rather than
scattering memoisation on faith and claiming it as optimisation work.

## Alternatives considered

**Next.js (App Router).** The obvious default for a production fintech app, and the wrong
default here. Everything behind a login is client-rendered anyway, so SSR buys nothing; the
server component boundary adds a concept the reviewer has to hold while reading unrelated
code; and MSW's browser worker fights with the server runtime in ways that would cost hours
that belong to the actual requirements. Choosing Next.js would mean spending the budget on
the framework instead of on the money handling.

**Create React App.** Unmaintained. Slower dev loop.

**Remix / TanStack Start.** Same reasoning as Next.js, with less familiarity in the room.

## Consequences

*What it buys:* sub-second HMR, a trivial `npm install && npm run dev`, a build output we
can actually reason about for a low-bandwidth audience, and a codebase with exactly one
rendering model.

*What it costs:* no SSR and no route-level data preloading. If NovaBiz ever grew a public
marketing surface or needed server-side session handling, this decision would be revisited.
We accept that cost because it is outside the scope of this dashboard.

*TypeScript `strict`* is on, together with `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`. This matters more than usual here: the money type in ADR-0002
depends on the compiler actually enforcing a branded type, which it will not do under loose
settings. Note the Vite template does **not** set these — they were added deliberately.

## How we would know we were wrong

- First contentful paint on a throttled 3G profile exceeds ~3s even after code splitting.
- We find ourselves hand-rolling server-side concerns (session refresh, secure cookie
  handling) that a meta-framework would have given us.
