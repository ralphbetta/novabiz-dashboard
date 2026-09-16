# ADR-0002 in plain English — Money formatting

> Plain-language companion to **[ADR-0002](ADR-0002-money-formatting.md)**. Same decision, no jargon.
> **Interview weight: ⭐⭐⭐ CRITICAL** — this is a named grading criterion. Know it cold.

## The problem

In JavaScript, `0.1 + 0.2` is `0.30000000000000004`. Decimals are approximations. Store money as
`1000.50`, add things up, and eventually you're a fraction of a kobo off — a real defect in a
banking app.

Money arrives from the API as `100050`, meaning 100,050 kobo. It has to appear as `₦1,000.50`.

## What I did

1. **Money is always a whole number of kobo.** `100050`, never `1000.50`.
2. **All arithmetic is on whole numbers**, through helpers that throw on overflow.
3. **A decimal only exists at the moment of formatting**, inside `src/lib/money.ts`.
4. **A branded `Kobo` type** — you can't pass an arbitrary number where money is expected.
5. **A lint rule bans `/ 100`, `* 100` and `.toFixed()`** outside the money module. There's a
   test proving the rule fires.

## Be precise about what the guards do — a panel will probe this

It's tempting to say "the type system makes it impossible." **It doesn't.**

- The **branded type** stops `formatNaira(Date.now())`. It does **not** stop `{amount / 100}` in a
  component — a `Kobo` is still a number, and dividing it compiles fine.
- The **lint rule** is what catches `{amount / 100}` — and `amount * 0.01`, `1e2`, `100.0`. But it
  **misses two forms**, and you should be able to name them:
  - a **named constant**: `const K = 100; amount / K`
  - **chained division**: `amount / 10 / 10`

  It misses them because the rule reads the *shape* of the code, not the *values*. It can't know
  `K` is 100. Catching that needs a much heavier custom rule, which isn't worth it here. Both gaps
  have tests that assert they're **not** caught — so if anyone later claims wider coverage, a test
  fails and the docs have to be corrected.

So neither makes drift impossible. Together they make it **loud** — the obvious mistake fails the
build, and the sneaky versions need a deliberate workaround a reviewer can see.

**Saying that unprompted is stronger than overclaiming.** If you say "impossible", someone types
`amount / 100` in a component and proves you wrong.

## The clever bit

`Intl.NumberFormat` can take a **string**, not just a number. So I build `"1000.50"` with
whole-number maths and hand the formatter a string. No decimal number is ever created.

**Why not just `format(kobo / 100)`?** Because it's genuinely wrong for big amounts. Past about
**₦10 trillion**, the number needs 16 digits and a JavaScript number only reliably holds 15.
`8373871690112718 / 100` shows as `₦83,738,716,901,127.19` — one kobo out.

## The bug the tests caught — tell this story

Older Android browsers don't support passing a string, so there's a fallback. My first fallback
was `format(Number("83738716901127.18"))`. It looked right, I'd reasoned about it, and it passed
every hand-written test — because every test used small amounts.

A **property test** — "the fallback must agree with the main path, for 5,000 random amounts" —
failed on its very first run. It found the ₦10 trillion problem above.

The fix: format the **whole-naira part** on its own (a whole number, so exact), then stick the two
kobo digits on the end. Exact everywhere.

**One precise detail:** it was the *fallback-agreement* test that caught it, not the round-trip
test. The round-trip can't reach the fallback on a modern engine. If asked which test found it,
name the right one.

## Three smaller decisions worth knowing

**One minus sign.** Negatives use the ordinary hyphen, because that's what `Intl` produces. So a
balance and a transaction row always show the same amount identically.

**Sign has one source.** `formatSignedNaira` takes a positive amount plus "credit" or "debit". If
you pass a negative amount it **throws**. An earlier version quietly used the absolute value, so
a negative "credit" rendered as `+₦1,000.50` with no error — exactly the kind of mismatch you
want to hear about loudly in a payments flow.

**`₦`, not `NGN`, on cheap phones.** Some phones ship trimmed locale data. Without it, Nigerian
formatting falls back to generic English and shows `NGN 1,000.50`. Using `narrowSymbol` keeps
the `₦`. **Honest limit:** tested on Node by simulating the fallback — not yet on a real low-end
Android phone.

## Why not the obvious alternatives

**`(kobo / 100).toFixed(2)`** — what AI suggests first. Float maths, no thousands separators, and
the lint rule now bans it.

**A library like dinero.js** — right if I were doing FX or interest. Here it's only adding and
subtracting same-currency integers. A dependency would cost bundle size on metered data to
replace about 100 lines of logic.

## What it costs me

A `toKobo()` call at every API boundary, and fussier test fixtures. The module is about 210 lines
across two files, roughly half comments.

There's a ceiling: `Number.MAX_SAFE_INTEGER` kobo, about ₦90 trillion. Past it, arithmetic throws
rather than drifting. A small merchant's wallet won't get there.

## Say this

> "Kobo integers end to end and one formatter. A branded type stops arbitrary numbers being used
> as money, and a lint rule stops `/ 100` outside the money module — the type alone can't do
> that, because a Kobo is still a number. And a property test caught a real one-kobo bug in my
> fallback path above ten trillion naira that none of my hand-written tests could reach."
