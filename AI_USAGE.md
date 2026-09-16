# AI_USAGE.md

> **⚠ THIS IS A SCAFFOLD, NOT A SUBMISSION.**
>
> Sections marked **`⚠ FILL IN`** contain placeholder text describing what to write. Replace
> them with what actually happened as you build. Do not submit invented prompts or invented
> bugs — the brief is assessing judgement, and a fabricated "here's where AI was wrong" is both
> detectable and the worst possible signal in a hiring process.
>
> **Keep this file open while you work.** Paste prompts in as you send them. This is
> unreconstructable after the fact — three days later you will not remember the exact wording
> of the prompt that produced the bad rollback code.
>
> Delete this entire block before submitting.

---

## 1. Tools used

| Tool | Used for |
|---|---|
| **Claude (Opus, via Claude Code)** | Architecture planning, the ADR set in `docs/adr/`, `AGENT.md`, and this plan. Reviewing my optimistic-update logic against failure modes I hadn't enumerated. |
| ⚠ FILL IN — e.g. **GitHub Copilot** | Inline completion for MSW handlers, Tailwind class strings, test boilerplate |
| ⚠ FILL IN — e.g. **ChatGPT** | One-off questions (`Intl.NumberFormat` string-input support, `aria-rowindex` semantics in virtualised lists) |

**Where I did not use AI:** ⚠ FILL IN. *(Honest answers here are strong. Something like: "I
wrote the reconciliation state machine by hand after rejecting two generated versions — the
logic is subtle enough that I wanted to be certain I understood every branch, since I'll be
defending it live.")*

---

## 2. Concrete prompts

### Prompt 1 — ⚠ FILL IN: the money formatting one

**What I asked:**

```
⚠ Paste your actual prompt.
```

**What came back:**

```ts
⚠ Paste the actual response, or the relevant part of it.
```

**What I did with it:** ⚠ Did you accept it? Modify it? Reject it? Why?

---

### Prompt 2 — ⚠ FILL IN: the optimistic-update one

**What I asked:**

```
⚠ Paste your actual prompt.
```

**What came back:**

```ts
⚠ Paste it.
```

**What I did with it:** ⚠ FILL IN.

---

### Prompt 3 — ⚠ FILL IN: something where AI genuinely saved you time

Worth including one of these so the file isn't only a list of AI failures — the brief says
they want evidence of using AI **to move faster** as well as evidence of catching it being
wrong. Good candidates: generating the 1,200-row seed data with realistic Nigerian merchant
descriptions, scaffolding MSW handlers from the contract types, or generating the Playwright
boilerplate.

**What I asked:**

```
⚠ Paste it.
```

**What came back:** ⚠ FILL IN.

**Why this was a good use:** ⚠ Something like — it's high-volume, low-risk, easily verified
work. The failure mode is "the data looks odd", not "a merchant loses money." That's exactly
the kind of task to delegate, and the money and reconciliation logic is exactly the kind not
to.

---

## 3. Where AI was wrong or risky

> **This is the section that's actually being graded.** The brief names two likely candidates
> — naive kobo maths and a rollback that doesn't reconcile. Below is the structure to use.
> **Replace the content with what really happened to you.** If the AI made a *different*
> mistake, write that one up instead — a real, specific, unexpected catch is worth far more
> than the one they predicted.

### Case 1 — ⚠ FILL IN

**What it produced:**

```ts
⚠ The actual bad code.
```

**Why it was wrong:** ⚠ Be precise and technical. Name the specific input that breaks it and
the specific consequence.

**How I caught it:** ⚠ This matters as much as the catch itself. Did a test fail? Did you spot
it in review? Did you only find it when you tried a specific input? Saying "a property-based
round-trip test over 10,000 values failed on X" is much stronger than "I noticed it looked
wrong."

**What I did instead:** ⚠ Your fix, plus the guard that stops it recurring — the test you added,
the lint rule, the note in `AGENT.md`.

---

### Case 2 — ⚠ FILL IN

Same structure.

> **Strong candidate for one of these, if it happened to you:** the RTK Query documentation's
> own optimistic-update example is
> `try { await queryFulfilled } catch { patchResult.undo() }`. That bare `catch` cannot
> distinguish a `422` from a timeout, so copying it into a payments app rolls back transfers
> that may have succeeded. If an assistant handed you that — and it very likely will, since it
> is the canonical pattern in the training data — it is an unusually good write-up: the AI was
> not hallucinating, it was correctly reproducing official guidance that is wrong for *this*
> domain. Say that explicitly. It is a sharper point than "the AI got it wrong."


---

### Case 3 (optional) — a suggestion I rejected for reasons AI couldn't know

⚠ Strong material if you have it. The pattern: the generated code was *technically* fine but
wrong for **this** context — Nigerian users on low-end Android, NDPA constraints, metered data,
CBN disclosure expectations. For example, a suggestion to persist the transfer draft to
`localStorage` is good generic UX advice and a privacy problem when the draft contains an
account number and the phone is shared.

That's the distinction the brief is really testing: AI is good at generic-correct, and the job
is knowing where generic-correct isn't correct here.

---

## 4. How I directed the AI

⚠ FILL IN — a short paragraph. Some things worth saying if they're true:

- I gave it the constraints up front (kobo integers, the four failure states) rather than
  accepting a generic answer and patching it.
- I asked it to enumerate failure modes rather than to write the implementation, then wrote the
  implementation myself.
- I wrote `AGENT.md` specifically so that assistants working in this repo wouldn't reproduce
  mistakes I'd already caught once. *(That file is in the repo root — it's the standing
  instruction set for AI tools, as distinct from this file, which is the record of what I did
  with them.)*
- I treated anything touching money or the rollback path as requiring a test before I'd accept
  it, regardless of how confident the output looked.

---

## 5. My honest assessment

⚠ FILL IN — a few sentences. Where did AI genuinely help, where was it actively dangerous, and
what's your rule for when to trust it?

A defensible position, if it's yours: AI was excellent at high-volume, easily-verified work
(seed data, handler scaffolding, test boilerplate, Tailwind) and actively dangerous on the two
places where the correct answer is counter-intuitive — money precision and knowing what a
timeout does and doesn't tell you. On both, the first suggestion was confident, idiomatic, and
wrong, because the common pattern on the internet *is* the wrong pattern for payments. The rule
I'd take forward: **the more confidently generic the output looks, the more likely it is that
it hasn't understood the constraint that makes this domain different.**
