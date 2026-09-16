# ADR-0002 in plain English — Money formatting

> Plain-language companion to **[ADR-0002](ADR-0002-money-formatting.md)**. Same decision, no jargon.
> **Interview weight: ⭐⭐⭐ CRITICAL** — this is a named grading criterion. Know it cold.

## The problem

In JavaScript, `0.1 + 0.2` is `0.30000000000000004`. Decimals are approximations. So if you
store money as `1000.50` and add things up, you eventually get answers that are off by a
fraction of a kobo — and in a banking app, that's a real defect, not a rounding curiosity.

Money arrives from the API as `100050`, meaning 100,050 kobo. It has to appear as `₦1,000.50`.

## What I did

Four rules:

1. **Money is always a whole number of kobo.** `100050`, never `1000.50`.
2. **All arithmetic is on whole numbers.** Adding, subtracting, totals — integers only.
3. **It only becomes a decimal at the last possible moment**, in one file, `src/lib/money.ts`,
   using `Intl.NumberFormat`.
4. **TypeScript enforces it** with a *branded type* — `Kobo` is a number the compiler won't let
   you mix up with an ordinary number. So you physically can't pass the wrong thing.

## The clever bit worth mentioning

`Intl.NumberFormat` can accept a **string**, not just a number. So I build the string
`"1000.50"` using whole-number maths (`Math.trunc(kobo / 100)` for the naira part, `kobo % 100`
for the kobo part — both exact on integers) and hand the formatter a string. **A decimal number
never exists in the program at all.**

There's a fallback for older Android WebViews that don't support string input — which matters,
because low-end Android is literally the stated audience.

## Why not the obvious alternative

**`(kobo / 100).toFixed(2)`** — this is what AI suggests first and what looks fine in testing.
It creates a float, it has no thousands separators, and it does the wrong thing with negatives.

**A library like dinero.js** — correct, and genuinely right if I were doing FX or interest.
Here the entire maths surface is adding and subtracting same-currency integers. A dependency
would add bundle weight for people on metered data, to replace a 40-line file the panel can
read in full.

## What it costs me

A `toKobo()` call at every API boundary, and slightly fussy test fixtures. That fussiness is
the point — it's what makes the mistake impossible rather than just discouraged.

There's a ceiling: `Number.MAX_SAFE_INTEGER` kobo, about ₦90 trillion. I documented it rather
than engineering around it, because a single small merchant's wallet will not reach several
times Nigeria's GDP.

## Say this

> "Kobo integers end to end, one formatter, and a branded type so the compiler blocks the
> mistake instead of relying on code review to catch it. Formatting takes a string built from
> integer maths, so a float never exists anywhere in the app."
