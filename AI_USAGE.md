# AI usage

AI wrote most of the first drafts in this repository: the ADRs, the plan, `AGENT.md`, and the money
module and its tests. It also got a number of things wrong, some of them confidently and in ways
that would have shipped. This file records what I used it for, what I asked, and — in more detail —
where it was wrong and how each error was caught.

The pattern across those errors: the generated **code** was mostly caught by tests, while the
generated **documentation** repeatedly claimed more than the code did. An independent review pass
found almost all of the second kind. The model's own checks did not.

## 1. Tools

| Tool | Used for |
|---|---|
| **Claude Code** (Claude Opus 5), in VS Code | Breaking down the brief; drafting the 15 ADRs, their plain-English companions, the implementation plan and `AGENT.md`; writing `src/lib/money.ts` and its tests; applying review fixes. |
| ⚠ **Name the reviewer:** tool or person | Two adversarial review passes over the money module and docs. Found most of the issues in §3. |

**Where I did not use AI:** I scaffolded the Vite app myself, and interrupted the agent to do it. I
chose the state-management stack myself, after rejecting the one the model had picked for me (§3.2).

## 2. Prompts

Quoted verbatim, typos included.

### Prompt 1 — understanding the brief

> I need you to give me a breakdown of what this assessment is about and all that is expected of
> me without missing any … in plain terms

**What came back:** a structured breakdown of the five functional requirements, the five hard
constraints, deliverables, stretch goals and scoring criteria. It usefully flagged that the
idempotency key must be stable across retries, which is not obvious from the brief's wording.

**What I did with it:** used it as the checklist for everything that followed.

### Prompt 2 — planning, and where the AI overstepped

> i need a comprehensive adr, adr for dummies and implementation plan for this. also create an
> agant.md along side the one they requested.

**What came back:** 15 ADRs, a plan and `AGENT.md`. The architecture was coherent, and the
reconciliation design in ADR-0006 — treating a timeout as *unknown* rather than *failed* — is the
strongest idea in the repo.

**The problem:** it had silently chosen TanStack Query + Zustand and written every document around
that choice. I hadn't been asked. See §3.2.

### Prompt 3 — challenging that

> did you ask me which statemanagement i intend to use or you thought you should decide for me

**What came back:** the model acknowledged it had decided unilaterally, then asked me to choose
state management, styling and E2E runner. I chose **Redux Toolkit + RTK Query**, Tailwind and
Playwright. It rewrote ADR-0003, ADR-0004 and ADR-0006, and patched the other documents.

**Why this prompt mattered:** the brief requires me to defend these decisions live. A stack I
hadn't chosen, with 15 documents arguing for it, would have been the worst thing to walk in with.

## 3. Where the AI was wrong

Ordered by how badly each would have hurt.

### 3.1 A money-formatting bug, plus a documented claim that it was correct

**What it produced.** Some older Android WebViews can't pass a string to `Intl.NumberFormat`. The
first fallback for them converted the decimal string back to a number:

```ts
: nairaFormatter.format(Number(decimal))
```

ADR-0002 then described this fallback as "correct across the entire range this app can produce."

**Why it was wrong.** Above about ₦10 trillion, the decimal needs 16 significant digits, and a double
holds 15. The result is silently one kobo out, well inside the valid amount range.

**How it was caught.** The model had also written a property test asserting that the fallback agrees
with the primary path over 5,000 random amounts. It failed on its first run:

```
expected '₦83,738,716,901,127.19' to be '₦83,738,716,901,127.18'
```

Every case in the hand-written table used a small amount. Reasoning had not caught it, and neither
had the table.

**Fix.** The fallback now formats the whole-naira part, which is an exact integer, via
`formatToParts`, and splices the two kobo digits into the fraction slot. A regression test pins the
failing amount.

**A second error on top of the first.** When updating ADR-0002, the model credited the catch to the
round-trip test (10,000 runs). The reviewer flagged the mismatch. It was the 5,000-run agreement
test, and the round-trip *could not* have caught it: on an engine with Intl V3 string input, Node
included, the round-trip never executes the fallback.

### 3.1b A design error in the reconciliation rule itself

**What it produced.** ADR-0006 — the document this project leans on hardest — said that when the
reconciliation lookup returns `404`, "the request never reached the server. It is now safe to undo."
The mock API was built to match: `NOT_FOUND` carried `rejected: true`, the flag that tells the client
rolling back is safe. The ADR's own error table also listed `409` as a definite failure.

**Why it was wrong.** A `404` can't distinguish "never received" from "not processed yet". If the POST
is slow, the client times out, looks the key up, gets `404`, rolls back and — per ADR-0007 — discards
the key. The POST then lands and debits, and the merchant, told it failed, resends under a new key.
This is precisely the false "nothing was written" the whole design exists to prevent, and it sat in the
design document, the code, and a test titled "the signal that rolling back is safe". A `409` is only
possible *because* something already exists under the key.

**How it was caught.** Independent adversarial review, which walked an in-flight POST through the
lookup. Analysing that finding surfaced a variant the review did not name: an insufficient-funds
refusal of a retry could later become a success if the timed-out original landed after the balance
rose. Each case was confirmed by a test that failed against the unfixed code before any fix was made.
One such test initially passed for the wrong reason — the balance never changed between attempts — and
had to be rewritten so it could fail.

**Fix.** `rejected: true` now has one precise meaning, pinned per error code: *no transfer exists
under this key, and none ever will.* `NOT_FOUND` and `IDEMPOTENCY_KEY_REUSED` are `false`. The mock
binds every processing outcome to the key, rejections included, and the lookup returns a bound
rejection as a conclusive answer. The client decides from the flag, never the status code. ADR-0006,
its plain-English companion, `AGENT.md` and the error table were all corrected. The same review also
found seed keys the store didn't know, pending seed rows that never settled, a throwing settlement hook
that stranded a transfer, and a narration fingerprint that turned an identical retry into a conflict.

### 3.2 Choosing the state-management stack for me

**What it produced.** 15 ADRs arguing for TanStack Query + Zustand, a stack I never chose.

**Why it was risky.** Being able to defend the choice is part of the assessment. The documents were
persuasive enough that I might have adopted the stack by default, then had to defend another
person's reasoning under questioning.

**How it was caught.** I asked directly (Prompt 3).

**Fix.** I chose Redux Toolkit + RTK Query, and the affected documents were rewritten. The rewrite
also improved ADR-0006: the RTK Query documentation's own optimistic-update example ends in
`catch { patchResult.undo() }`, which rolls back on a timeout. That is precisely the bug ADR-0006
exists to prevent.

### 3.3 Documentation claiming guards that did not exist

This was the most frequent error, and it is the category a review panel probes. Each item below was
stated as fact:

| Claim | Reality |
|---|---|
| ADR-0002: the branded type "makes the drift impossible rather than merely discouraged." | A `Kobo` is still a `number`, so `{amount / 100}` in a component compiles. The brand only stops raw numbers being passed as money. |
| ADR-0002: "A lint rule" bans `/ 100`. | `eslint.config.js` had no such rule. |
| `AGENT.md`: "CI greps for it." | There is no CI. |
| ADR-0013 and `AGENT.md`: `react/no-danger` is set to error. | The React lint plugin was not installed. |
| `AGENT.md` command list | Listed `npm run e2e`, `test:ui` and `jsx-a11y` — none existed. |
| ADR-0001 title | Said React 18; the project uses React 19. |

**How it was caught.** Independent review, which compared each claim against the code instead of
against the other documents.

**Fix.**
- The money lint rule now exists. `money.lint.test.ts` asserts that it fires, so it can't silently
  stop matching.
- The `dangerouslySetInnerHTML` ban became a `no-restricted-syntax` rule, which needs no plugin.
- Every claim was rewritten to match the code. ADR-0002 now has a table of what each guard does
  and does not prevent.

**A follow-up gap.** The second review found that `x * 0.01` and `const K = 100; x / K` both passed
the new lint rule. Probing further found `x / 0.01` and `x / 10 / 10` passed too. I closed the
`0.01` forms. The named-constant and chained-division forms need data-flow analysis, which a syntax
rule can't do. Rather than leave the docs to overclaim again, those two gaps have **tests asserting
they are not caught**, so widening the rule later forces the ADR to be updated.

### 3.4 A formatter that hid a sign mismatch

**What it produced.**

```ts
export function formatSignedNaira(kobo: Kobo, direction: 'credit' | 'debit'): string {
  const magnitude = formatNaira(Math.abs(kobo) as Kobo)
  return direction === 'credit' ? `+${magnitude}` : `\u2212${magnitude}`
}
```

**Why it was wrong.** Two sources of sign — the amount and `direction` — and `Math.abs` resolved any
disagreement silently. `formatSignedNaira(-100050, 'credit')` rendered `+₦1,000.50` with no error.
In a reconciliation-heavy payments flow, that's the mismatch you want to hear about. The test only
covered a negative *debit*, the one case that happens to work.

It also used U+2212 for the minus sign, while `formatNaira` used a hyphen, so a balance and a
transaction row could show the same amount differently.

**How it was caught.** Independent review.

**Fix.**
- The function now takes a non-negative magnitude and throws on a negative one. There are tests for
  both directions.
- Negatives use a hyphen everywhere, with a test that a debit row matches a negative balance
  byte for byte.

### 3.5 Smaller errors

- **A feature-detection probe that detected nothing.** The first draft of the plan tested for Intl V3
  string support with `format('1.5') === format(1.5)`. Older engines coerce `'1.5'` to a number, so
  that comparison is true on both paths. The model caught this itself before any code was written,
  and switched to a probe value that loses precision as a double.
- **Invisible characters.**
  - A non-breaking space inside a regex character class made `npm run lint` fail.
  - The plan document contained a literal U+202E right-to-left override: the spoofing character
    ADR-0013 warns about, sitting unescaped in a doc.
  - Both were removed. A scan confirms no other hidden characters remain.
- **An invented business rule.** ADR-0009 stated a "₦100 minimum" transfer as though it were a
  requirement. The brief never mentions one. The model flagged it while writing the README, which now
  lists it as an assumption.
- **A permissive parser.** It stripped every comma and space anywhere, so `"1,0,0,0"` and `"10 00"`
  parsed as valid amounts. It now requires correct grouping.
- **A Trojan Source pattern, introduced by the agent's own tooling — three times.** Unicode escapes
  typed by the agent (`\u202E`, `\u00A0`, `\u2212`) were decoded into raw characters on the way into
  files, so source that was meant to hold escape text held a literal right-to-left override,
  zero-width characters, a non-breaking space and a look-alike minus sign. A code comment then claimed
  escapes had been used and that lint "would rightly reject" raw characters; neither was true, because
  `no-irregular-whitespace` skips strings by default and does not cover bidi controls at all. Caught
  by independent review. **Fix:** the characters are now written as escapes by generating the backslash
  programmatically; `src/source-hygiene.test.ts` scans src, docs and config for any raw format
  character or look-alike and fails the build; lint is configured strictly. The scan immediately found
  three more raw minus signs in the docs.
- **Timestamps claimed to sort as strings, but did not.** The contract accepted any fractional
  precision, and `"...00.500Z" < "...00Z"` although it is the later instant. Caught by review; the
  contract now requires exactly millisecond precision, with a test demonstrating the mis-sort.
- **"Deterministic" seed data that was not, across time of day.** Random draws were skipped for rows
  older than a day, shifting every later draw, so generating at 09:00 and 21:00 changed the top rows —
  and, as a check showed, all 1,200 ids. Caught by review. **Fix:** each row draws from its own
  seeded stream with all values drawn up front; a test asserts ids, names and descriptions are
  identical across times of day and dates.
- **Tied timestamps the pagination plan ignored.** At exactly midnight all of today's seed rows share
  one timestamp, so a cursor on `createdAt` alone would skip or repeat rows. Caught by review; the
  seed now guarantees a strict order on `(createdAt, id)`, tested at midnight, and the plan requires
  the Part 2 cursor to use that pair.
- **Seed data that was internally consistent but unrealistic.** The first draft failed 130 of ~340
  debits for insufficient funds; the first correction produced none, and a later rewrite silently
  produced no pending rows. Both states the UI must show now exist by construction, with tests
  bounding them.
- **A test suite that could not catch the most important error it was guarding.** In the mock API,
  making every error response claim `rejected: true` — which would tell the client to roll back a
  transfer after a server crash — still passed all 54 tests, because no test ever produced an
  `INTERNAL_ERROR`. Found by deliberately breaking the code to check each test could fail, not by
  review. It also revealed that an unexpected exception returned MSW's generic 500, whose body did not
  match the error contract. **Fix:** an error boundary on every handler, and a test driving a crash
  through each endpoint.
- **A documented guarantee that the code did not keep, and silent failure where the docs promised
  otherwise.** The chaos controls' code and ADR-0005 promised that forcing an outcome could not shift which
  later requests the random rates hit. It could, for any POST that created nothing, because the settlement
  roll was drawn only on creation. A test covered only two POSTs that both created a transfer, so it could
  not see the gap. Separately, `update()` was documented as throwing rather than silently mishandling
  input, yet `update({ latency: 5000 })` returned normally and changed nothing. Both caught by the second
  adversarial review; each confirmed by a failing test, which for the random-draw case showed the per-request
  counts varying between 4 and 5. Manual mutation checks run earlier had not found it, so the plan no longer
  reports mutation counts as if they were evidence of completeness.
- **A stale code sample.** The implementation plan's Phase 1 section still held the buggy fallback
  from §3.1 after the source was fixed. The sample was removed and replaced with links to the real
  files.

## 4. How I directed it

- **I checked its work against a second opinion rather than its own.** The model's self-review caught
  its code bugs through tests. It did not catch its documentation overclaiming. The independent
  review did, by checking each claim against the code.
- **I asked it to prove its tests weren't hollow.** For each review fix, the fix was reverted to
  confirm a test failed. Sign check: 2 failures. Parser grouping: 3. Naive fallback: 2. Removing the
  lint rule: 5.
- **I made it verify before asserting.** Every npm script listed in the README was run first. Every
  link was checked. The hard-coded test count was removed, since it would go stale.
- **I overrode it on decisions that were mine.** State management, and doing the scaffold myself.

## 5. Assessment

⚠ *Rewrite this section in your own words — it's your judgement, not the model's. The draft below
only restates what the entries above show.*

The AI was fast and genuinely useful for structure: turning a brief into ADRs, a plan and a test
design. It also produced one idea I consider the core of the project — treating a timeout as
unknown rather than failed. Its failures had a consistent shape. The code it wrote was usually
caught by the tests it wrote. But its prose described intentions as facts: guards that didn't
exist, ranges it hadn't verified, a sign-handling contract its implementation didn't keep.

The rule I'd take forward: **treat every generated claim of the form "X is prevented" or "X is
correct across Y" as unverified until a test or a command demonstrates it.** Property tests caught
what hand-picked cases missed, and a reviewer comparing docs to code caught what the model's own
review missed.
