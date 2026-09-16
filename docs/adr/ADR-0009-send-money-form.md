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
`type="number"`. Number inputs on Android surface an inconsistent keypad, silently accept
`1e5`, and allow scroll-wheel changes on desktop — all three are wrong for a money field. The
displayed value is formatted on blur; the parsed `Kobo` integer is what the schema validates.

**Server-side validation is authoritative.** The mock enforces the same rules, and the client
surfaces server field errors in the same slots as client errors. The client's copy of the
rules is there for speed, not for trust.

### Accessibility specifics

- every input has a real `<label for>`, never a placeholder standing in for one;
- errors are rendered in an element referenced by `aria-describedby`, with `aria-invalid` on
  the field;
- the step heading receives focus on step change, so a screen reader announces the new step
  instead of leaving the user's focus stranded on a button that no longer exists;
- the step indicator is `aria-current="step"`;
- validation runs on blur and on submit, not on every keystroke — per-keystroke validation
  makes a screen reader announce an error while the user is still typing the value.

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

## How we would know we were wrong

- Client and server validation disagree on a real input.
- The step composition becomes hard to follow as steps are added.
