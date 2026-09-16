# ADR-0015 in plain English — What I cut, on purpose

> Plain-language companion to **[ADR-0015](ADR-0015-scope-cuts.md)**. Same decision, no jargon.
> **Interview weight: ⭐ medium** — but the compliance point is a differentiator. See below.

## The problem

The brief says outright: this is more than can be gold-plated, and they'd rather see good
judgement about what to prioritise than a rushed attempt at everything.

## The insight

> **An unwritten cut looks exactly like an oversight.**

If you don't say you decided not to build login, the panel can't tell whether you decided or
just ran out of time. So write them down.

## What I built properly

Money handling · optimistic reconciliation · idempotency · the three async states everywhere ·
feed performance · accessibility · sanitisation · the tests.

**These are the graded criteria.** That's where the time went.

## What I cut, and why

| Cut | Why |
|---|---|
| **Login / auth** | The brief starts at a signed-in merchant. A fake login screen costs real time and demonstrates nothing being assessed. |
| **Storybook** (stretch goal) | **Cut first, knowingly.** Highest cost of the four stretch goals, lowest signal for a panel that's about to see the running app. |
| **Offline write queue** | Needs UX design, not just code — it'd need a confirm-on-reconnect. Named as the top follow-up. |
| **i18n** | Real for a West African product. No copy is hard-coded into logic, so it's addable — but a translation layer for one locale is scaffolding. |
| **Receipts / share PDF** | Merchants genuinely want this. Not assessed. |

## The compliance bit — this is the differentiator

The brief says strong candidates will *notice where the Nigerian regulatory constraints matter*.
The strong move is showing where a constraint **actually changed a technical decision**, not
just name-dropping the regulation.

Two real ones:

**NDPA 2023** is why the half-filled transfer form isn't saved to `localStorage` — it holds an
account number, and the phone may be shared. A privacy rule decided a storage decision.

**CBN consumer protection** is the real reason the `unknown` state in
[ADR-0006](ADR-0006-optimistic-send.dummies.md) is shown honestly instead of hidden behind a
tidy rollback. *"We don't know yet, don't resend"* is a **disclosure obligation**, not just
nice UX.

Also: account numbers are masked everywhere **except** the review step — where the merchant must
verify the full number before confirming. Masking it there would cause mis-sends; showing it in
the feed is needless exposure.

## Why not the obvious alternative

**Attempt everything at lower quality** — produces a demo that falls over on the first hard
question, and every hard question here is in the reconciliation path.

## Say this

> "I cut Storybook first — highest cost, lowest signal when you're going to see the app running
> anyway. And two regulatory constraints actually changed technical decisions rather than just
> getting a mention."
