# ADR-0009 in plain English — Send Money form

> Plain-language companion to **[ADR-0009](ADR-0009-send-money-form.md)**. Same decision, no jargon.
> **Interview weight: ⭐ medium** — but the `type="number"` detail lands well.

## The problem

Four steps — recipient → amount → review → confirm. Each has its own validation rules. The
merchant types `1,000.50` and that has to become the integer `100050` without a decimal ever
existing.

## What I did

**React Hook Form** for form state (inputs are uncontrolled, so typing doesn't re-render the
whole wizard) with **Zod** schemas — **one schema per step**, composed into a whole.

Advancing a step validates just that step. Confirming validates *everything again* — because a
valid amount at step 2 might be invalid by step 4 if a scheduled debit landed in between.

## The best bit

**The mock server imports the same Zod schemas the client uses.** Not a copy — the same objects.
So client and server validation literally cannot drift apart.

## The detail that lands well

The amount field is `type="text"` with `inputMode="decimal"`, **not `type="number"`**. Three
reasons, all real:

- `type="number"` gives an inconsistent keypad on Android
- it silently accepts `1e5`
- it changes value on scroll-wheel on desktop — imagine that on a transfer amount

All three are wrong for a money field, and most people never think about it.

## Accessibility, done here rather than later

- real `<label>` on every field — a placeholder is never a label
- errors sit in an `aria-describedby` target, with `aria-invalid` on the field
- focus moves to the new step's heading on each step change
- validation runs on **blur**, not every keystroke — otherwise a screen reader announces an
  error while the user is still mid-way through typing the value

## Why not the obvious alternative

**Formik + Yup** — fine, heavier, and Formik re-renders on every keystroke by default.

**Hand-rolled validation** — no dependency, and the "re-validate step 2's rules at step 4" bit
is exactly where hand-rolled validation quietly rots.

## What it costs me

Two dependencies, and the discipline of keeping client and mock rules in sync — which the
shared-schema trick above handles structurally.

## Say this

> "One schema per step, composed and re-validated at confirm. And the mock server imports the
> same schemas, so the two can't disagree."
