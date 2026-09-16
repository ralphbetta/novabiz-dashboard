# ADR-0005 in plain English — Mock API

> Plain-language companion to **[ADR-0005](ADR-0005-mock-api.md)**. Same decision, no jargon.
> **Interview weight: ⭐⭐ high** — this is also your demo weapon. See the chaos panel below.

## The problem

There's no backend. The brief says build one, with simulated latency and a configurable failure
rate so error states can actually be tested.

**The trap:** the lazy reading is "stub out some functions". But then your app never makes a
real HTTP request — so you can never test a timeout, a retry, or a 500 arriving after the UI
already said "sent". Which is the entire hard part of this brief. You'd validate the happy path
and nothing else.

## What I did

**MSW**, which intercepts at the **network layer**. The app genuinely calls `fetch()` and
genuinely gets HTTP back. It has no idea it's being mocked — there is no `if (isMock)` branch
anywhere in the app code.

The same handlers run in three places: the browser app, the component tests, and Playwright. So
a passing test means a working app.

And it's a **stateful little server**, not canned responses:

- 1,200 seeded transactions from a fixed seed, so it's reproducible
- cursor pagination and real server-side filtering
- a balance derived from the ledger, so a transfer actually changes it
- an idempotency store that **replays** the original response for a repeated key
- transfers return `202 pending` and settle a few seconds later — because that's how NIP
  actually behaves, and it's what makes the reconciliation work meaningful instead of theoretical

## The chaos panel — your demo weapon

A dev panel with sliders for latency, failure rate and timeout rate, plus a switch:

> **Force next send to: success / failure / timeout / duplicate key**

That last one matters more than it looks. A random failure rate is impossible to demo — you'd
be tapping Send hoping something breaks. This lets you say *"watch, I'm going to make the next
one time out"* and then show the reconciliation working. It's also what stops the E2E tests
being flaky.

## Why not the obvious alternative

**json-server or an Express mock** — needs a second process, which breaks the single-command
requirement, and can't be reused inside component tests.

**Stubbed modules** — fast to write, and hides the network entirely. See the trap above.

## What it costs me

A service worker file to register, and the seed data has to stay in sync with the TypeScript
types. I generate it from the same types the app consumes, so it can't drift.

## Say this

> "I mocked at the network layer so the app never knows it's mocked, and I built deterministic
> failure controls so I can demo the error paths on demand instead of hoping something breaks.
> Tell me which failure you want to see."
