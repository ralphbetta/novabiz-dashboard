# AGENT.md — working agreement for AI agents in this repo

This file is read by AI coding agents (Claude Code, Cursor, Copilot Workspace, Windsurf) before
they touch anything here. It is the project's standing instructions.

It exists because this is a **payments** codebase. The usual defaults an assistant reaches for —
naive currency maths, snapshot-and-restore rollback, retry-everything — are wrong here in ways
that cost a real merchant real money. The rules below are not style preferences. Most of them
encode a specific bug that was caught during development.

> `AI_USAGE.md` is the separate, required deliverable: it records what the *human* did with AI
> tools. **This** file is the instruction set pointed *at* the tools.

---

## Project in one paragraph

React 19 + TypeScript + Vite dashboard for a small merchant on the NovaBiz module of FirstBank
NovaPay. State is **Redux Toolkit + RTK Query** in a single store; styling is Tailwind; E2E is
Playwright. It shows a wallet balance and transaction feed, and provides a multi-step Send Money
flow. There is no backend — MSW provides a stateful in-memory API. Target users are on low-end
Android phones on unreliable connections in Nigeria.

Full reasoning for every decision below is in `docs/adr/`. **Read the relevant ADR before
changing the thing it covers.**

---

## The five rules that are not negotiable

### 1. Money is an integer number of kobo. Always.

- Money is typed `Kobo` (a branded number). Never a plain `number`, never a `string`, never a
  float.
- **All arithmetic is on integers.** Sums, totals, differences. No exceptions.
- `/ 100`, `* 100` and `.toFixed()` appear **only** inside `src/lib/money*.ts`. ESLint
  `no-restricted-syntax` fails the build on them anywhere else, and `money.lint.test.ts` proves the
  rule fires. **Do not add an `eslint-disable` to get past it.**
- The branded `Kobo` type does **not** stop `amount / 100` — a Kobo is still a number. The lint
  rule is the guard. Don't reason that "the types will catch it"; they won't.
- Formatting happens **only** via `formatNaira()`. Not `toLocaleString`, not template literals,
  not `.toFixed(2)`, not string slicing.
- Parsing merchant input happens **only** via `parseNairaInput()`. Never `parseFloat(x) * 100` —
  that reintroduces the float. It is a parser, **not** a validator: it accepts zero and negatives.
  The Send Money schema **must** carry an explicit `> 0` rule, independent of the ₦100 minimum,
  with tests for `0` and negatives. Nothing else in the app rejects them.
- Transaction rows use `formatSignedNaira(magnitude, direction)`. It takes a **non-negative**
  magnitude and throws otherwise. Never `Math.abs` an amount to make it stop throwing — the throw
  is reporting a real sign mismatch.
- Negatives use hyphen-minus (U+002D) everywhere. Do not introduce U+2212 in display code.

**If you are about to write `amount / 100` in a component, stop.** → `docs/adr/ADR-0002-money-formatting.md`

### 2. Never roll back an optimistic update on a timeout or a 5xx.

This is the most important rule in the repo and the one most likely to be "helpfully" undone.

- Only a response body with `error.rejected: true` → no transfer exists under the key, and none ever
  will → **safe to roll back**. Decide from that flag, **never from the status code**.
- **A `404` from the reconciliation lookup is NOT safe to roll back on.** The original POST may still
  be in flight. Stay `unknown` and keep polling. (An earlier version of ADR-0006 got this wrong.)
- **A `409 IDEMPOTENCY_KEY_REUSED` is NOT safe to roll back on.** It only happens because something
  already exists under the key. Look it up.
- Do not change a `false` in `REJECTED_BY_CODE` (`src/api/contracts.ts`) to `true`, and do not stop the
  mock binding rejections to their key. Either would make the server promise something it can't keep.
- A timeout, a network error, or a `5xx` → **you do not know what happened** → the transfer may
  have gone through → go to the `unknown` state and reconcile. **Do not restore the balance.**
- `isDefiniteFailure()` in `src/lib/errors.ts` is the only thing allowed to make that call.
  Every `onQueryStarted` catch block must branch on it. A bare `catch { patch.undo() }` is a bug
  even though it is what the RTK Query docs show.
- `'TIMEOUT_ERROR'`, `'FETCH_ERROR'`, `'PARSING_ERROR'` and any `5xx` are **not** definite
  failures. Only two things are: a body with `error.rejected: true`, and `REQUEST_NOT_SENT` — a request the
  base query refused before calling fetch. Never produce `REQUEST_NOT_SENT` anywhere a request may already
  have been sent.

Rolling back on a timeout tells a merchant their money is safe when it may already be gone. They
resend, and pay twice.

**Do not "simplify" the four-state machine (`pending | settled | failed | unknown`) into a
boolean.** The `unknown` state is the entire point. → `docs/adr/ADR-0006-optimistic-send.md`

### 3. The idempotency key belongs to the attempt, not the request.

- Generated **once** when the merchant confirms, stored on the attempt in the `transferDraft`
  slice (and the bare key in `sessionStorage`, so a force-close can still be reconciled).
- **Every** retry — automatic, manual, or reconciliation lookup — reuses the same key.
- Never generate a key inside a fetch wrapper or a request function. A per-request key protects
  against nothing at all.
- Cleared only on a terminal state. Changing amount or recipient starts a new attempt with a new
  key. → `docs/adr/ADR-0007-idempotency.md`

### 4. Reads may retry automatically. Writes may not.

- **The base query never retries a mutation**, whatever the endpoint's options say. A new write endpoint is
  safe by default. Do not weaken that check in `src/api/baseQuery.ts`; `review-findings.test.ts` adds an
  unguarded POST and asserts it is sent once.
- `sendMoney` also carries `extraOptions: { maxRetries: 0 }` as a second, visible guard. Keep it.
- Reads retry with exponential backoff **and full jitter**. The jitter is not optional.
- A failed transfer surfaces a *Try again* button. A human decides. → `docs/adr/ADR-0014-offline-retry.md`

### 5. All merchant- and counterparty-supplied text is untrusted.

- **No `dangerouslySetInnerHTML`.** An ESLint `no-restricted-syntax` rule fails the build on it,
  with a test proving it fires. Do not disable it.
- Descriptions and counterparty names pass through `sanitizeText()` at the API boundary —
  which strips control characters, zero-width characters, and **bidirectional overrides**. React
  escaping does not handle bidi, and bidi is a spoofing vector in a payments UI.
- Never auto-link URLs found in descriptions. → `docs/adr/ADR-0013-input-sanitisation.md`

---

## House style

**State.** Redux Toolkit, one store. Server-owned data → an **RTK Query endpoint**. Client-only
data → a **plain RTK slice**. There is no third bucket. Do not mirror RTK Query cache data into
a slice, and do not hand-write thunks for data an endpoint should own.

**Selectors.** Select narrowly: `useAppSelector(s => s.transferDraft.amountKobo)`, never a whole
slice. A coarse selector re-renders on every unrelated keystroke and looks identical in review.
Derived values go through `createSelector`.

**Serializability.** Everything in the store must be serializable. Dates are ISO strings, parsed
at the edge. Never put a `Date`, a `Map`, or a class instance in state.

**Invalidation.** Prefer a targeted `updateQueryData` patch over `invalidatesTags`. Users are on
metered, slow connections — refetching a page of transactions to learn one fact is a real cost.
The send flow patches and invalidates nothing. Tags are for genuine cross-entity relationships.

**Components.** Presentational components take data as props and do not fetch. Fetching lives in
`src/api/*` hooks. A component that both fetches and renders a complex tree should be split.

**Async states.** Every fetching surface renders **loading**, **empty**, and **error** explicitly.
"Empty because filtered" is a different message from "empty because new merchant". A bare
`isLoading && <Spinner/>` with no error branch will be rejected in review.

**Accessibility.** Native elements before ARIA. Every input has a real `<label for>` —
placeholders are never labels. Errors go in an `aria-describedby` target with `aria-invalid`.
Never remove a focus outline. Live regions must already be in the DOM and have their text
swapped in, never mounted together with their content.

**Responsive.** Mobile-first. Unprefixed Tailwind classes are the **360px** case; `sm:` and `lg:`
add capability. Never write a desktop layout and shrink it. Tap targets ≥ 44×44px.

**Colour.** Never signal meaning with colour alone. Credit/debit and status carry a sign, a text
label, and an icon.

**Types.** `strict` plus `noUncheckedIndexedAccess`. No `any`. No non-null `!` without a comment
explaining the invariant. No `@ts-expect-error` without a linked issue.

---

## Testing expectations

- New logic in `src/lib/` needs unit tests in the same change.
- Anything touching `money.ts`, `errors.ts`, `idempotency.ts`, or the `sendMoney` endpoint's
  `onQueryStarted` needs a test
  demonstrating the failure case, not just the happy path.
- Component tests run against the **real MSW handlers**, never stubbed modules.
- No snapshot tests. No tests asserting that a `<div>` rendered.
- The E2E test `send-money.spec.ts › timeout on a committed transfer` is load-bearing. **If your
  change makes it fail, your change is wrong** — do not adjust the test to match the new
  behaviour without reading `docs/adr/ADR-0006-optimistic-send.md` first. → `docs/adr/ADR-0011-testing.md`

### Fixing a bug or a review finding: failing test first

Every bug fix and every review finding follows this order:

1. **Write a test that reproduces the problem** before changing the code it tests.
2. **Run it against the unfixed code and confirm it fails.** Report what failed. If you cannot write
   a test that fails, the finding is unconfirmed: say so instead of fixing it on faith.
3. **Check it fails for the right reason.** Read the failing assertion. A test that fails during
   setup, or passes against the broken code, proves nothing. Example from this repo: the
   insufficient-funds binding test first passed on the unfixed code because the balance never changed
   between the two attempts. It had to be rewritten so the broken code could fail it.
4. **Then fix the code**, and confirm the same test now passes without loosening its assertions.
5. **Keep the test** as the regression guard. `src/mocks/review-findings.test.ts` is the model.

If an existing test encodes the wrong behaviour, rewrite it along with its premise and its title.
Don't just change the expected value until it passes. Say which test changed and why.

Changes to prose alone (docs, comments) don't need a test.

---

## Commands

```bash
npm run dev         # Vite dev server
npm test            # Vitest, run once
npm run test:watch  # Vitest, watch mode
npm run lint        # ESLint, incl. the money and dangerouslySetInnerHTML guards
npm run typecheck   # tsc
```

Not yet wired — do not assume these exist: `npm run e2e` (Playwright, Phase 8), MSW in
`npm run dev` (Phase 2), `eslint-plugin-jsx-a11y` (Phase 4).

Before proposing a change as complete, run `npm run lint && npm run typecheck && npm test`.
Report what those commands actually printed.
Do not report a task as done on the strength of the code looking right.

---

## What to do when you are unsure

**Ask rather than guess** when a change would:

- alter how money is calculated, displayed, or parsed;
- alter the optimistic update or rollback path;
- alter the idempotency key's lifetime;
- add a dependency (the bundle is shipped to people on metered data);
- disable an ESLint rule or a test.

**Proceed without asking** for styling, copy, adding tests, extracting components, or anything
covered explicitly by the rules above.

---

## Known-bad suggestions

Every one of these has been generated by an assistant on this codebase and every one is wrong
here. If you are about to produce one, produce the alternative instead.

| Suggestion | Why it is wrong |
|---|---|
| `` `₦${(kobo/100).toFixed(2)}` `` | Float division, no locale grouping, breaks negatives. → `formatNaira()` |
| `try { await queryFulfilled } catch { patchResult.undo() }` | **The RTK Query documented pattern**, and a money-losing bug here — a bare `catch` cannot tell a `422` from a timeout. Rule 2. |
| Generating the idempotency key inside the request function | Every retry gets a new key. Rule 3. |
| Letting the base query retry a mutation, or making write safety depend on each endpoint opting out | A write added later would be sent up to four times. The base query refuses by `api.type`. Rule 4. |
| `dangerouslySetInnerHTML` for a description | Rule 5. |
| `useState` in the wizard parent for the draft | Lost on navigation. → `docs/adr/ADR-0004-client-state.md` |
| `responseSchema: SomeContractSchema` on an RTK endpoint | Does not typecheck: contract schemas turn `number` into `Kobo`. Parse in `transformResponse`. → `docs/adr/ADR-0003-server-state.md` |
| Reading `extraOptions.x` in the base query without `?.` | `extraOptions` is `undefined` at runtime for endpoints that set none, whatever its type says. |
| Wrapping the base query in RTK's `retry()` again | Its backoff cannot read the store's timing config, and with `retryCondition` it stops enforcing the retry limit. The base query has its own loop. |
| Relying on `keepUnusedDataFor: 0` to make a lookup fresh | It only drops the entry once nothing subscribes. A subscribed repeat lookup returns the cache. Use `forceRefetch`. |
| Building a second API instance for tests with `createNovabizApi`-style factories | Hooks are bound to the one `novabizApi`. Configure timing through `makeStore({ http })` instead. |
| Reconciliation in a `useEffect` | Dies when the merchant navigates away mid-transfer. It belongs in listener middleware. → `docs/adr/ADR-0006-optimistic-send.md` |
| `invalidatesTags: ['Transactions']` after every send | Refetches the whole feed on a slow connection. Patch instead. |
| Hand-written thunks + slices for server data | That is the Redux RTK Query exists to delete. → `docs/adr/ADR-0003-server-state.md` |
| `useAppSelector(s => s.transferDraft)` | Re-renders on every keystroke. Select the field. |
| `redux-persist` for the theme | Rehydration machinery for two fields. → `docs/adr/ADR-0004-client-state.md` |
| Client-side filtering of the loaded pages | Filters a partial dataset and shows a wrong answer. → `docs/adr/ADR-0008-transaction-feed.md` |
| `type="number"` for the amount field | Bad Android keypad, accepts `1e5`, scroll-wheel changes. → `docs/adr/ADR-0009-send-money-form.md` |
| Adding MUI/Chakra "to move faster" | Deliberately rejected. → `docs/adr/ADR-0010-styling-responsive.md` |
| Persisting the transfer draft to `localStorage` | Leaves an account number on a shared device. → `docs/adr/ADR-0004-client-state.md` |

---

## The one-line summary

**When something goes wrong with money, the correct behaviour is to tell the truth about what
you don't know — not to produce a clean-looking state that might be a lie.**
