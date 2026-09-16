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

1. Money is a **branded integer type**:
   ```ts
   declare const koboBrand: unique symbol
   export type Kobo = number & { readonly [koboBrand]: true }
   ```
   The only way to construct one is `toKobo()`, which rejects fractions, non-finite values and
   integers past `Number.MAX_SAFE_INTEGER`.
2. All arithmetic — sums, today's inflow/outflow totals, balance projections — happens on
   **integer kobo**, via `addKobo` / `subtractKobo` / `sumKobo`, which throw on overflow rather
   than silently losing precision.
3. A decimal exists in exactly one place — the moment of formatting — inside
   `src/lib/money.ts`, using `Intl.NumberFormat`.
4. Parsing merchant input (`"1,000.50"` → `100050`) uses **string-decimal arithmetic**, never
   `parseFloat(x) * 100`.
5. **An ESLint rule bans `/ 100`, `* 100`, `100 *`, `/= 100`, `*= 100`, `* 0.01`, `/ 0.01` and
   `.toFixed()` everywhere except `src/lib/money*.ts`.** A test asserts the rule fires, so it cannot silently
   stop matching.

### What each guard actually prevents

It is worth being precise, because the two guards are easy to over-credit:

| Guard | Prevents | Does NOT prevent |
|---|---|---|
| Branded `Kobo` type | Passing an arbitrary number where money is expected — `formatNaira(Date.now())` | `{amount / 100}` in a component. A `Kobo` is still a `number`, and arithmetic on it compiles. |
| ESLint `no-restricted-syntax` | `/ 100`, `* 100`, `* 0.01`, `/ 0.01`, `.toFixed()` outside the money module — including `1e2` and `100.0` spellings | A **named constant** (`const K = 100; amount / K`), **chained division** (`amount / 10 / 10`), or an inline `eslint-disable` |

Neither makes drift *impossible*. Together they make it **loud**: the obvious form fails the
build, and the non-obvious forms require a deliberate workaround that a reviewer can see.

The two known gaps are structural, not oversights. `no-restricted-syntax` matches syntax, not
values: it cannot know that an identifier `K` holds 100, or that two divisions by 10 compose to
one by 100. Closing them needs data-flow analysis — a type-aware custom rule — which is not worth
building for a take-home. Both gaps are **pinned as uncaught by tests** in `money.lint.test.ts`,
so this table cannot silently become an overclaim: widening the rule fails those tests and
forces this ADR to be updated.

### Formatting without a float

`Intl.NumberFormat.prototype.format` accepts a **string** argument (Intl.NumberFormat V3). We
build that string with integer arithmetic, so no float is ever created:

```ts
const sign  = kobo < 0 ? '-' : ''
const abs   = Math.abs(kobo)
const whole = Math.trunc(abs / 100)   // exact: abs is a safe integer
const rest  = abs % 100               // exact: integer remainder
formatter.format(`${sign}${whole}.${String(rest).padStart(2, '0')}`)
```

**Why not just `format(kobo / 100)`?** Because it is wrong at the top of our range. The
decimal for a large amount needs 16 significant digits, and a double holds 15. Below roughly
**₦10 trillion** it happens to round correctly; above it, it silently returns a figure one kobo
off. `8373871690112718 / 100` formats as `₦83,738,716,901,127.19`. That is well inside the valid
`Kobo` range, and it is not a hypothetical — see below.

### The fallback for older WebViews

String input to `format()` is not available on older Android WebViews, which are precisely our
stated audience, so `money.ts` feature-detects once at module load. (The probe uses a value that
survives as a string but not as a double; a probe like `'1.5'` passes on both paths and detects
nothing.)

The obvious fallback is `format(Number(decimalString))`. It yields the same double as
`kobo / 100`, and so fails in exactly the same place.

The fallback instead formats the **whole-naira part** — a safe integer, therefore exact — via
`formatToParts`, and splices the two kobo digits into the fraction slot. That is exact across the
entire `Kobo` range, and inherits the locale's grouping and symbol placement rather than
assuming them.

**How the bug was found.** The first implementation used the naive numeric fallback. It was
reasoned about carefully and it passed the hand-written test table, every case of which was a
small amount. It was caught by a **property test asserting the fallback agrees with the primary
path over 5,000 random amounts**, which failed on its first run. The round-trip property
(`parseNairaInput(formatNaira(k)) === k`, 10,000 runs) could *not* have caught it: on any engine
with Intl V3 string input, Node included, the round-trip never reaches the fallback. A regression
test now pins the exact amount.

### The currency symbol on reduced-ICU devices

The formatter uses `currencyDisplay: 'narrowSymbol'`. If a device ships reduced ICU data without
the `en-NG` locale, `en-NG` falls back to `en`, whose NGN symbol is the ISO code — the merchant
would see `NGN 1,000.50`. The narrow symbol lives in root locale data and survives that fallback,
rendering `₦1,000.50`. A test formats under `en` and `und` to assert it.

**Honest limit:** this is verified on Node, which has full ICU, by simulating the fallback
locale. It is **not yet verified on a real low-end Android WebView**. Doing so is the stronger
evidence for this ADR's audience argument than any of the fallback code, and it is on the list.

### One minus sign

Negative amounts use **U+002D hyphen-minus** everywhere, because that is what `Intl` emits. A
balance of `-₦2,500.00` and a debit row of `-₦2,500.00` are therefore byte-identical, and every
formatted string round-trips through the parser.

The typographically correct U+2212 minus sign was considered and rejected: it would require
post-processing `Intl` output in one place and not another, and two renderings of the same
amount is precisely the inconsistency this ADR exists to prevent. The parser still *accepts*
U+2212, since pasted text may contain it.

### Sign has one source of truth

`formatSignedNaira(magnitude, direction)` takes a **non-negative magnitude** and lets `direction`
alone decide the sign. A negative amount **throws**. An earlier version called `Math.abs`, so
`formatSignedNaira(-100050, 'credit')` quietly rendered `+₦1,000.50` — two disagreeing sources of
sign, resolved silently. In a reconciliation-heavy flow, that is exactly the mismatch to surface
loudly.

### Parser scope

`parseNairaInput` is a **parser, not a transfer validator**. It rejects malformed grouping
(`"1,0,0,0"`, `"1,00.50"`, `"10 00"`), more than two decimal places, and exponent notation. It
deliberately **accepts zero and negatives**, because those are valid amounts in general. The Send
Money schema (ADR-0009) must separately enforce a positive amount, the minimum, and the available
balance — and must not rely on this function to do so.

## Alternatives considered

**`dinero.js` / `big.js` / `decimal.js`.** Correct, and genuinely the right answer for an app
that does multi-currency conversion, interest accrual, or FX on the diaspora corridor. Here the
entire arithmetic surface is addition and subtraction of same-currency integers. A dependency
would add bundle weight for a low-bandwidth audience to replace about 100 lines of logic across
two files, which the panel can read in full.

**`BigInt`.** Removes the `Number.MAX_SAFE_INTEGER` ceiling. That ceiling is
₦90,071,992,547,409.91 — about 90 trillion naira, several times Nigeria's annual GDP, for a
single small merchant's wallet. BigInt would cost JSON serialisation friction and `Intl` interop
for a bound we cannot reach. We document the bound instead of engineering around it.

**Storing naira as a float and rounding on display.** Named only to be explicit that it was
rejected. It is the bug the brief is testing for.

## Consequences

*What it buys:* the compiler rejects an arbitrary number passed as money. The lint rule fails
the build on the obvious conversion. Totals are exact by construction. There is one module to
read to audit all money handling, and one to change if formatting rules change.

*What it costs:* a `toKobo()` call at every API boundary, and mild ceremony building test
fixtures. The module is about 210 lines across `money.ts` and `money.internal.ts`, roughly half of
it comments — more than it would be without the fallback path, which exists only for devices we
have not yet tested on.

*Ceiling, stated explicitly:* amounts are valid up to `Number.MAX_SAFE_INTEGER` kobo. Arithmetic
beyond it throws rather than drifting.

## How we would know we were wrong

- A displayed figure ever disagrees with the sum of its parts by one kobo.
- A real reduced-ICU WebView renders `NGN` despite `narrowSymbol`, or lacks `formatToParts`.
- A conversion reaches a component without tripping the lint rule — meaning the rule's selectors
  are too narrow, and the guard needs widening rather than trusting.
- We need multiplication (interest, FX, percentage fees). At that point a decimal library stops
  being over-engineering and becomes correct, and this ADR is superseded.
