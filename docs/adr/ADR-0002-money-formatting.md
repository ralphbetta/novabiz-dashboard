# ADR 0002 — Money is an integer number of kobo, end to end

**Status:** Accepted · **Date:** 2026-09-16

## Context

Money enters the app as an integer number of kobo. `100050` must render as `₦1,000.50`.
The brief names this as non-negotiable and calls out naive kobo→naira maths as a known
failure mode.

The real risk is not the formatting function. It is **drift**: one developer, in one
component, six weeks later, writing `{amount / 100}` because it looks right in the browser.
A single correct formatter that is easy to bypass is not a solution.

## Decision

1. Money is represented as a **branded integer type**: `type Kobo = number & { readonly __brand: 'Kobo' }`.
2. All arithmetic — sums, today's inflow/outflow totals, balance projections — happens on
   **integer kobo**, never on naira floats.
3. Formatting is the **only** place a decimal appears, and it is done by one module,
   `src/lib/money.ts`, using `Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' })`.
4. Parsing merchant input (`"1,000.50"` → `100050`) is done by the same module, by
   **string-decimal arithmetic**, not by `parseFloat(x) * 100`.
5. A lint rule and a code review habit: no raw `/ 100` or `* 100` outside `money.ts`.

### The formatting detail that actually matters

`Intl.NumberFormat.prototype.format` accepts a **string** argument (Intl.NumberFormat V3).
We build that string from integer arithmetic:

```ts
const sign  = kobo < 0 ? '-' : '';
const abs   = Math.abs(kobo);
const naira = Math.trunc(abs / 100);         // exact: abs is a safe integer
const rest  = abs % 100;                      // exact: integer remainder
const decimalString = `${sign}${naira}.${String(rest).padStart(2, '0')}`;
return nairaFormatter.format(decimalString);  // no float ever enters the formatter
```

This is stricter than passing `kobo / 100`. In practice `kobo / 100` also rounds correctly
for every amount below ~₦90 trillion, because `Intl` rounds to two fraction digits and the
representation error is many orders of magnitude smaller. We do not rely on that argument,
because it is an argument a reader has to verify rather than a property they can see.

**Fallback.** String input to `format()` is not available on older Android WebViews, which
is precisely our stated audience. `money.ts` feature-detects once at module load and falls
back to the numeric path, which is correct across the entire range this app can produce. The
fallback is exercised by its own unit test.

## Alternatives considered

**`dinero.js` / `big.js` / `decimal.js`.** Correct, and genuinely the right answer for an app
that does multi-currency conversion, interest accrual, or FX on the diaspora corridor. Here
the entire arithmetic surface is addition and subtraction of same-currency integers. A
dependency would add bundle weight to a low-bandwidth audience and hide a 40-line module
that the panel can read in full.

**`BigInt`.** Removes the `Number.MAX_SAFE_INTEGER` ceiling. That ceiling is ₦90,071,992,547,409.91 —
about 90 trillion naira, several times Nigeria's annual GDP, for a single small merchant's
wallet. BigInt would cost us JSON serialisation friction and `Intl` interop for a bound we
cannot reach. We document the bound instead of engineering around it.

**Storing naira as a float and rounding on display.** Named here only to be explicit that it
was rejected. It is the bug the brief is testing for.

## Consequences

*What it buys:* the compiler rejects `formatNaira(someRandomNumber)`. Totals are exact by
construction. There is exactly one file to read to audit all money handling, and exactly one
file to change if formatting rules change.

*What it costs:* a `toKobo()` call at every API boundary, and mild ceremony when constructing
test fixtures. We consider that ceremony to be the point — it is what makes the drift
impossible rather than merely discouraged.

*Ceiling, stated explicitly:* amounts are valid up to `Number.MAX_SAFE_INTEGER` kobo. Sums
are checked against it and surface as an error rather than silently losing precision.

## How we would know we were wrong

- A displayed figure ever disagrees with the sum of its parts by one kobo.
- We need multiplication (interest, FX, percentage fees) — at that point a decimal library
  stops being over-engineering and becomes the correct call, and this ADR gets superseded.
