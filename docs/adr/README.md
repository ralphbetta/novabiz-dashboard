# Architecture Decision Records — NovaBiz Merchant Dashboard

Every decision has **two files with the same number and slug**:

| File | Audience | Contains |
|---|---|---|
| `ADR-NNNN-<slug>.md` | The review panel | Context · Decision · Alternatives · Consequences · How we'd know we were wrong |
| `ADR-NNNN-<slug>.dummies.md` | You, before the interview | The same decision in plain English, plus the line to say out loud |

They sit next to each other so you never have to hunt for the matching half.

Cross-cutting interview material — what an ADR is, the 60-second opening, likely questions —
is in [../INTERVIEW-PREP.md](../INTERVIEW-PREP.md).

## The template

Every ADR answers the same five questions:

1. **Context** — what pressure made this a decision rather than a default?
2. **Decision** — what we're doing, in one sentence.
3. **Alternatives considered** — what else was on the table, and the honest reason it lost.
4. **Consequences** — what this buys us **and what it costs us**.
5. **How we would know we were wrong** — the observable signal that would make us revisit.

That last section is the one most ADRs omit and the one a reviewer cares about most.

An ADR is written once, at the moment of the decision, then left alone. If a decision is
reversed later we don't edit the old record — we write a new one that supersedes it.

## Index

**Weight** = how likely this is to be probed in the interview.
⭐⭐⭐ critical · ⭐⭐ high · ⭐ medium · ○ low

| # | Feature / topic | ADR | Plain English | Weight | Status |
|---|---|---|---|---|---|
| 0001 | Application stack | [ADR](ADR-0001-application-stack.md) | [plain](ADR-0001-application-stack.dummies.md) | ○ | Accepted |
| 0002 | **Money formatting** | [ADR](ADR-0002-money-formatting.md) | [plain](ADR-0002-money-formatting.dummies.md) | ⭐⭐⭐ | Accepted |
| 0003 | Server state (RTK Query) | [ADR](ADR-0003-server-state.md) | [plain](ADR-0003-server-state.dummies.md) | ⭐⭐ | Accepted |
| 0004 | Client state (Redux slices) | [ADR](ADR-0004-client-state.md) | [plain](ADR-0004-client-state.dummies.md) | ⭐ | Accepted |
| 0005 | Mock API | [ADR](ADR-0005-mock-api.md) | [plain](ADR-0005-mock-api.dummies.md) | ⭐⭐ | Accepted |
| 0006 | **Optimistic send & reconciliation** | [ADR](ADR-0006-optimistic-send.md) | [plain](ADR-0006-optimistic-send.dummies.md) | ⭐⭐⭐ | Accepted |
| 0007 | **Idempotency** | [ADR](ADR-0007-idempotency.md) | [plain](ADR-0007-idempotency.dummies.md) | ⭐⭐⭐ | Accepted |
| 0008 | Transaction feed | [ADR](ADR-0008-transaction-feed.md) | [plain](ADR-0008-transaction-feed.dummies.md) | ⭐⭐ | Accepted |
| 0009 | Send Money form | [ADR](ADR-0009-send-money-form.md) | [plain](ADR-0009-send-money-form.dummies.md) | ⭐ | Accepted |
| 0010 | Styling & responsiveness | [ADR](ADR-0010-styling-responsive.md) | [plain](ADR-0010-styling-responsive.dummies.md) | ⭐ | Accepted |
| 0011 | Testing strategy | [ADR](ADR-0011-testing.md) | [plain](ADR-0011-testing.dummies.md) | ⭐⭐ | Accepted |
| 0012 | Accessibility | [ADR](ADR-0012-accessibility.md) | [plain](ADR-0012-accessibility.dummies.md) | ⭐ | Accepted |
| 0013 | Input sanitisation | [ADR](ADR-0013-input-sanitisation.md) | [plain](ADR-0013-input-sanitisation.dummies.md) | ⭐⭐ | Accepted |
| 0014 | Offline & retry | [ADR](ADR-0014-offline-retry.md) | [plain](ADR-0014-offline-retry.dummies.md) | ⭐ | Accepted |
| 0015 | Scope cuts | [ADR](ADR-0015-scope-cuts.md) | [plain](ADR-0015-scope-cuts.dummies.md) | ⭐ | Accepted |

## Reading order

**If you have 10 minutes:** 0002, 0006, 0007 — in plain English. That's the money, the
reconciliation and the double-send protection, which is what the assessment is actually about.

**If you have an hour:** add 0003, 0005, 0008, 0011, 0013.

**Before the panel:** all 15 plain-English files, then [../INTERVIEW-PREP.md](../INTERVIEW-PREP.md).
