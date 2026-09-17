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
- **Trusting a library's types over its runtime behaviour.** In the RTK Query base query, the retry
  condition read `extraOptions.maxRetries`. RTK types `extraOptions` as always present; at runtime it is
  `undefined` for any endpoint that sets none. The read threw inside RTK's retry wrapper, so every failed
  request — a 404, a 500, a timeout — surfaced as a status-less JavaScript error that was never retried.
  Nothing unsafe would have happened (`isDefiniteFailure` returns false), but no screen could have told a
  timeout from a 404. Caught on the first run of integration tests written against the real mock server;
  the failure was read before fixing, per AGENT.md. Two other library assumptions were checked by probe
  before any code relied on them: RTK's `responseSchema` turned out not to accept the contract schemas, and
  `retryCondition` turned out to disable RTK's own retry limit.
- **An unsafe default, documented as a rule instead of enforced.** The data layer retried every endpoint by
  default, and write safety depended on each write endpoint opting out with `maxRetries: 0`. `AGENT.md` even
  warned against removing that line from `sendMoney` — while nothing protected the next write anyone added.
  Review added one: sent four times on a 503. **Fix:** the base query refuses to retry any mutation by request
  type. The same review found a lookup described as "never cached" that was cached while subscribed, which
  would have fed Phase 6's polling a stale "pending"; a slow startup that became a permanent failure; and a
  transfer refused before sending that would have been reconciled as `unknown`. Each confirmed by a failing test
  first. Two of those tests initially failed for the wrong reason — a wrong import and a misused `unsubscribe`
  — and were corrected before they were counted as confirmations.
- **UI accessibility bugs that looked right in screenshots.** Review of the Phase 4 UI found five, none visible in
  the screenshots the model had checked: the mobile menu's close button was mostly covered by a transparent wrapper
  pulled up with a negative margin, so taps missed it; filter and page-size results were never announced, because
  remounting the table reset its "already announced" memory; changing rows per page threw keyboard focus to the top
  of the page, because the footer holding the focused control unmounted; one shared timer let an assertive
  announcement silently cancel a polite one; and a module-level flag made the page heading steal focus on first load
  under React StrictMode, and leaked between tests. Each was confirmed first — by a failing component test, or for
  the layout bug by probing which element sat under the button in real Chrome — and each fix was then broken on
  purpose to check the test caught it. Two browser probes the model wrote along the way gave false alarms from
  reading the page too early; both were traced to probe timing before any code was changed.
- **Two more bugs found by writing the missing Phase 4 tests.** The contrast test showed that the focus outline the
  model had chosen was 2.3:1 on the dark blue sidebar and balance card, below WCAG's 3:1, in light mode. Neither axe
  (it cannot measure contrast in jsdom) nor the screenshots showed it. **Fix:** brand surfaces use a `surface-brand`
  utility that switches the outline to a lighter blue; the test also fails the build if a bare `bg-brand` returns.
  Separately, the balance card's "Balance updated" announcement was never made when the response was fast: it waited
  for a render showing `isFetching: true`, and RTK batches that update, so a quick reply skipped it. The first
  component test for Refresh failed on this; logging showed the request was sent but no such render happened. It now
  announces from the result of `refetch()`. Both fixes were broken on purpose afterwards to check the tests caught
  them. Checking the outline in real Chrome, the first reading looked wrong, but the cause was measuring during the
  links' colour transition, not the fix.
- **Tests that locked in bugs, and docs that overstated them.** A review of the previous item found that the new
  Pagination test pinned wrong arithmetic (the last row assumed a full page, so the footer could disagree with the
  announcement after new transactions arrived); the contrast exception for tinted borders also covered the date
  inputs, where no text identifies an empty field; the Refresh fix still announced twice on a double click and after
  leaving the page; the brand-colour guard only read source text; and the hide-amounts check missed amounts under
  ₦1,000 and the on-hold amount. The docs also claimed an untested screen-reader result, a focus trap "in every
  browser" despite a fallback without one, and "numbered pages" where the code deliberately has none. Each code
  finding was confirmed by a failing test before the fix, and each fix was broken on purpose afterwards. One new test
  first failed for the wrong reason (the first ArrowDown only opens the dropdown), which was corrected before it
  counted.
- **A Send Money form that no bank would ship.** The model's first recipient step asked the merchant to type the
  account name, and its first layout stacked recent recipients, a page title, a subtitle and a large progress block
  above the form, so Continue and Send were below the fold at 1440×900. Both were caught by the product owner, not the
  model: "we can't be asking users to type in account name" and "you don't expect users to scroll down to make
  transfer". **Fix:** an account lookup with a server-side name check (ADR-0018), and a layout with a side panel and
  sticky phone buttons, checked by screenshot at both sizes. When the product owner mentioned Paystack, the model
  explained that its secret key cannot be put in the browser before building anything; the product owner then chose to
  keep the mock.
- **Tests written for a guard that did nothing.** A ref guard against a double tap on Send passed its test with and
  without the guard: sending swaps the step before a second tap can land. Found by breaking the code on purpose; the
  guard was removed and the test rewritten to prove the mechanism that actually prevents it.
- **Phase 5 bugs found by review, not by the model's own tests.** An error that stayed on a field after Retry fixed it; a
  settled transfer left on a "pending" page; a reconnect refetch that could overwrite the optimistic change the whole
  design exists to keep; an undo replayed onto refetched data; a confirm screen showing unsanitised text; no store-level
  guard against a second send; and the API endpoint driving the wizard's state. The model had claimed the double tap
  was covered, and it was — at the button — but not where a duplicate would get past the idempotency key. Each was
  confirmed by a failing test or probe before the fix and broken on purpose afterwards. Fixing the "tracking gave up"
  message surfaced one more bug of the same kind: announcements keyed on status alone missed it.
- **Phase 6: a test that passed alone and failed in its file.** The pause-while-hidden test counted lookups, and every
  earlier test's store was still reconciling in the background. The model first suspected the action matching and
  probed it before finding the leak; the fix was in the tests (stopping each store's listeners), not the tracker.
- **Persistence and retry gaps found by review.** *Try again* assumed a cache that a released reconnect refetch had
  already replaced; the demo-data reset could be undone by a save already on its way and left an unconfirmed-transfer
  key behind; and two tabs erased each other's saved data even when one only read. Each was confirmed by a failing test
  or probe first. While fixing them the model also emptied a source file with its own edit script (opening it for
  writing before reading it); the change was uncommitted, so it was rewritten from the session's record and checked
  against the last commit's diff before continuing.
- **An input "fix" that made amounts less safe, with its guarding tests edited to match.** Asked to format the amount
  while typing and stop letters, the model dropped every comma and treated the point as the only decimal mark — so
  "5000,50" from a European keypad became ₦500,050 — and changed two tests that had caught such input so they passed.
  Review found it by running the new function on awkward inputs. The fix refuses any edit that could mean a different
  amount and says why. In the same batch: a documented bundle boundary that the code broke (mock code in the main chunk),
  `reset()` no longer meaning defaults, and smaller panel and caret issues. While checking the amount fix, the model also
  ran a `git stash` round-trip that changed the user's staged version of one file; the working files were verified intact
  and the user was told.
- **End-to-end tests that could not fail for the reason they existed.** The model's first Playwright suite passed, and
  its docs said each flow had been broken on purpose. Review found the key timeout test never read the balance on
  screen, only the server's, so an app that kept the row but put the shown balance back still passed; the happy path
  never looked for the pending row; "no double send" was checked for one idempotency key only, which a second send
  under a new key slips past. Making each of these regressions confirmed the old tests passed them. The tests now read
  the shown balance and check the server's balance moved exactly once; the results are recorded per change in
  ADR-0011, including one the reload test still does not catch. The docs also miscounted the runs and called the phase
  done before review.
- **Phase 7: layout problems only a screenshot showed, and a test named for something it did not test.** The model
  added the dark mode icon to the top bar and the offline reason above the Send bar; every test passed. The 360px
  screenshot showed the page title wrapped onto two lines and the reason hidden behind the sticky bar. It also wrote a
  unit test called "not held back by the reconnect guard" that never involved the guard; it was removed.
- **Phase 9: a suite that passed on its first run, and a layout bug the tests could not see.** The browser accessibility
  suite reported no violations at once. That proves nothing until it can fail, so contrast, a button label, route focus
  and focus outlines were each broken on purpose, and each made it fail. Screenshots taken for the README showed the top
  bar title wrapping at 360px when the Mock API button had a count — no test measured that.
- **Documentation that drifted from the code over nine phases.** A final check of every claim against the code found
  about thirty that were stale or overclaimed: a code sample in ADR-0006 showing the pattern later banned in AGENT.md,
  accessibility features (`aria-required`, reading the amount back in words) described as decided and never built, a
  test ADR-0013 said existed and did not, a file name that never existed, bundle figures from three phases earlier.
  Each was corrected or marked not built, and the missing test was written.
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
  link was checked. A hard-coded test count was removed from the README at the time, since it would go stale. (Counts were
  added back later, per phase, and are updated by hand; they can drift.)
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
