# ADR 0015 — Scope we deliberately cut, and why

**Status:** Accepted · **Date:** 2026-09-16

## Context

The brief states that the task is intentionally larger than can be gold-plated, and that good
judgement about prioritisation is preferred over a rushed attempt at everything.

An unwritten cut looks identical to an oversight. This ADR exists so that every omission is on
the record as a decision.

## Decision

Build the hard constraints to production quality. Cut everything else, and say so.

### Built to full quality

Money handling (0002) · optimistic reconciliation (0006) · idempotency (0007) · the three
async states on every screen · feed performance (0008) · the accessibility baseline (0012) ·
untrusted text (0013) · the test set in (0011).

These are the graded criteria. They are where the time went.

### Deliberately not built

| Cut | Why |
|---|---|
| **Authentication / login** | The brief starts at a signed-in merchant. A fake login screen would consume real time and demonstrate nothing being assessed. A fixed merchant marks where the session would attach *(as built, a constant `MERCHANT` in `src/app/merchant.ts`, not a slice)*. |
| **Real routing beyond 3 views** | `react-router` is present for the views. *(Changed as built: there is one layout route for the dashboard, three pages — overview, transactions, send money — and no detail view. Pages load on demand since Phase 9, which took the main JavaScript from 215 to 166 kB gzipped; for the target phones on slow networks that proved worth it.)* |
| **Redux persistence layer** | `redux-persist` for two preference fields would be rehydration machinery with no payoff. A small `store.subscribe` writer does it (one key, the theme). → ADR 0004 |
| **Storybook** (stretch) | Highest cost of the four stretch goals and the lowest signal for a panel that will see the running app. Component boundaries are demonstrated by the tests instead. Cut first, and knowingly. |
| **Offline write queue** | Out of scope per ADR 0014, and it needs UX design rather than code. Named as the top follow-up. |
| **i18n** | Real for a West African product (Hausa, Yoruba, Igbo, Pidgin). No copy is hard-coded into logic, so it is addable, but a translation layer here would be scaffolding around one locale. |
| **Receipt / share PDF** | Merchants genuinely want this. Not assessed. |
| **Virtualised charts / analytics** | Not in the brief. |
| **CBN / NDPA compliance features** (consent logs, data export, retention) | Noted where they would attach — see below — but implementing a consent ledger in a take-home would be theatre. |

### Compliance touchpoints noticed but not implemented

The brief says strong candidates will notice where these constraints matter. Where they touch
this dashboard specifically:

- **NDPA 2023 data minimisation** — this is why the wizard draft is not persisted to
  `localStorage` (ADR 0004). That constraint changed a technical decision, which is the point.
- **Account numbers** are masked (`••••4821`) everywhere except the review step, where the
  merchant must verify the full number before confirming. Masking it there would cause
  mis-sends; showing it in the feed is needless exposure. *(Recent recipients follow the same rule: masked in the
  list, though the API returns the full number because it is needed to pay them again — ADR-0018.)*
- **CBN consumer protection** expects a merchant to be able to tell what happened to their
  money. This is the real reason the `unknown` state in ADR 0006 is shown honestly rather than
  hidden behind a clean rollback — "we don't know yet, don't resend" is a disclosure
  obligation, not only a UX preference.
- **Transaction references** are shown on every row (there is no detail view), because that is what a merchant
  quotes when they call support or file a dispute.
- **No PII in logs or error reports** — *not built:* the app has no logging or error reporting, so there is no
  boundary to redact at yet. Adding either would need it.

## Alternatives considered

**Attempt everything at lower quality.** Produces a demo that falls over on the first hard
question, and the hard questions here are all in the reconciliation path.

**Cut a hard constraint to buy a stretch goal.** The hard constraints are stated as
non-negotiable.

## Consequences

*What it buys:* the parts that are built are defensible under live questioning, which is the
stated interview format.

*What it costs:* the app is visibly narrower than the product described in the scenario. This
ADR and the README are what distinguish that from having run out of time.

## How we would know we were wrong

- The panel's questions concentrate on something in the cut list, meaning the priorities were
  misread.
