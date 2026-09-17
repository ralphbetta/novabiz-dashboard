# ADR 0009 — React Hook Form + Zod, with one schema per wizard step

**Status:** Accepted · **Date:** 2026-09-16

## Context

Send Money is four steps: recipient → amount → review → confirm. Each step has its own
validation rules, each must be keyboard-operable, and errors must be announced to assistive
technology rather than merely coloured red.

The amount field is the interesting one. Note that `parseNairaInput` (ADR-0002) is a parser, not
a validator: it deliberately returns `0` for `"0"` and a negative number for `"-5"`. **This
form is therefore the only thing standing between a merchant and a zero or negative transfer**,
and must reject both explicitly — not by accident of the ₦100 minimum, which would silently stop
covering zero if the minimum were ever lowered to it. A merchant types `1,000.50`. That string must become
the integer `100050` without a float ever existing (ADR 0002), and must be rejected if it
exceeds the available balance, falls below the ₦100 minimum, or carries more than two decimal
places.

## Decision

**React Hook Form** for form state (uncontrolled inputs, so typing does not re-render the
wizard) with **Zod** schemas for validation — **one schema per step**, composed into a whole:

```ts
const recipientSchema = z.object({ accountNumber: …, bankCode: …, accountName: … });
const amountSchema    = z.object({ amountKobo: …, note: … });
const transferSchema  = recipientSchema.merge(amountSchema);
```

Advancing a step validates only that step's schema. The confirm action validates the merged
schema, so a value that was valid at step 2 and became invalid by step 4 — the balance
dropped because a scheduled debit landed — is caught before submission rather than by the
server.

**Amount input handling:** the field is a text input with `inputMode="decimal"`, not
`type="number"`. *(As built, `src/features/send/amountInput.ts`: grouped while typing — "899889" shows "899,889" — with
the caret kept after the same digit. **An edit that could mean a different amount is refused, never reinterpreted:** a
typed comma (the decimal key on a phone set to a European region) is refused with "Use a point for kobo", a pasted amount
with commas out of place or too many decimals is refused, and so is a second point — the field keeps what it had and says
why. The first version dropped every comma, so "5000,50" became ₦500,050; review caught it. A leading minus is kept so a
pasted negative shows an error instead of becoming a positive amount. Deleting the first digit keeps the zeros after the
caret; removing only a comma removes the digit before it, handled on change because Android keyboards report keys as
"Unidentified".)* Number inputs on Android surface an inconsistent keypad, silently accept
`1e5`, and allow scroll-wheel changes on desktop — all three are wrong for a money field. The
displayed value is formatted while typing (see the note above); the parsed `Kobo` integer is what the schema validates.

**Server-side validation is authoritative.** The mock enforces the same rules. *(As built, a
server refusal is shown on the receipt with the server's message, not mapped back into the form's field slots; the
merchant can edit the transfer from there.)* The client's copy of the
rules is there for speed, not for trust.

### Accessibility specifics

- every input has a real `<label for>`, never a placeholder standing in for one;
- errors are rendered in an element referenced by `aria-describedby`, with `aria-invalid` on
  the field;
- the step heading receives focus on step change, so a screen reader announces the new step
  instead of leaving the user's focus stranded on a button that no longer exists;
- the step indicator is `aria-current="step"`;
- validation runs on blur and on submit, not on every keystroke — per-keystroke validation
  makes a screen reader announce an error while the user is still typing the value. *(As built: `mode: 'onBlur'`, but
  once a field shows an error it is re-checked on each change (`reValidateMode: 'onChange'`), so the error clears as
  soon as the value is fixed.)*

## Alternatives considered

**Formik + Yup.** Fine, heavier, and Formik re-renders on every keystroke by default.

**Uncontrolled inputs with hand-rolled validation.** No dependency. Rejected because the
composed-schema property above — "validate step 2's rules again at step 4" — is where
hand-rolled validation quietly rots.

**A single schema for the whole form, validated on submit only.** Means a merchant can fill
three steps before learning the account number was malformed at step 1.

## Consequences

*What it buys:* one source of truth per rule, shared between client and mock server; typed
form values inferred from the schema; no re-render storm while typing.

*What it costs:* two dependencies, and the discipline of keeping the mock's rules in sync with
the client's. We mitigate that by exporting the schemas from a shared module that the MSW
handlers import — the rules are literally the same objects, so they cannot drift.

## Implementation notes (Phase 5)

- **The recipient schema has no account name.** The merchant enters a number and bank; the name comes from the account
  lookup and is checked again by the server. See [ADR-0018](ADR-0018-account-lookup-and-beneficiaries.md). The sketch
  above predates that.
- **Step schemas are built from the contract's own rules** (`src/features/send/schemas.ts`): the amount pipes the parsed
  kobo into `SendMoneyRequestSchema.shape.amountKobo`, so "greater than zero" and the minimum are the same objects the
  mock uses. The form adds only what the contract cannot know: the bank is listed, the text parses, and it fits the
  balance on screen. `buildRequest` runs every rule again at confirm.
- **An invalid submit** focuses the first invalid field and announces the problems assertively ("There are 2
  problems. First: …"). Errors are linked with `aria-describedby` and set `aria-invalid`.
- **The draft lives in the store** (ADR-0004), including the values being typed, so a live summary can show them and
  leaving the page loses nothing.
- **`useWatch`, not `watch`,** for values the component renders: `watch` is not compatible with the React Compiler's
  memoisation.
- **Layout, at the product owner's request:** the form with a side panel (recent recipients on step 1, a live summary on
  step 2), a slim step row, no repeated page title, and buttons that stick to the bottom on phones, so the main
  action never needs a scroll.
- **Double send:** `sendTransfer` (src/store/sendTransfer.ts) refuses, sending nothing, while an attempt's outcome is
  open, and `attemptStarted` refuses to replace an open attempt. The first version relied only on the Send button
  disappearing before a second tap; review pointed out that each duplicate would carry a new key, so the idempotency key
  would not catch it. Both guards are tested.
- **Review shows what is sent:** the description comes from the built request (sanitised, ADR-0013), not from the draft,
  which holds what was typed.
- **Lookup errors are worked out, not stored:** the recipient step keeps only whether Continue was pressed, and derives
  the message from the lookup's current state, so an error cannot outlive a successful Retry.
- **Not the plan's "naive catch first".** The plan suggested rolling back on any error in Phase 5 and fixing it in
  Phase 6. `AGENT.md` already lists that as a money-losing bug, so the definite-failure rule was built directly.

## How we would know we were wrong

- Client and server validation disagree on a real input.
- The step composition becomes hard to follow as steps are added.
