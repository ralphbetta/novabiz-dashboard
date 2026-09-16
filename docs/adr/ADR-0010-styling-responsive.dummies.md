# ADR-0010 in plain English — Styling & responsiveness

> Plain-language companion to **[ADR-0010](ADR-0010-styling-responsive.md)**. Same decision, no jargon.
> **Interview weight: ⭐ medium** — the colour-blindness point is the one that lands.

## The problem

Must work from **360px to 1440px**, on low-end Android phones, with dark mode as a stretch goal,
and meet WCAG AA contrast.

360px isn't a rounded-down guess — it's the actual width of the Tecno, Infinix and Galaxy A
phones that dominate this market.

## What I did

**Tailwind**, written **mobile-first**: the unprefixed classes *are* the 360px layout, and
`sm:` / `lg:` **add** capability for bigger screens.

That direction matters. Design at 1440px and squeeze down, and the 360px case ends up broken —
it's the one nobody checks. Make it the default and it can't be forgotten.

Dark mode is a **token swap**: colours are semantic variables (`--color-surface`,
`--color-credit`), so dark mode redefines the tokens rather than adding a second set of classes
to every element. A unit test checks every token pair for AA contrast — an actual check, not an
eyeball.

## The point worth saying out loud

**Money is never shown by colour alone.** Green and red are always backed by a `+`/`−` sign and
a text label. Same for the pending/successful/failed badges — text and an icon, not just colour.

About 8% of men can't reliably distinguish red from green. This is a number people make
financial decisions on. Colour is reinforcement, never the signal.

## Why not the obvious alternative

**MUI or Chakra** would be the fastest route to a finished-looking screen. I didn't use one for
two reasons: the panel is grading my component boundaries and my accessibility work, and a
library answers both *on my behalf*. And it ships a large bundle to people I've specifically
decided to be careful with.

I did use **Radix primitives** (unstyled) for the dialog and select — focus-trapping and
typeahead are genuinely hard to hand-roll and aren't what's being assessed.

**CSS Modules** would be fine, and it scatters the responsive story across many files. Tailwind
keeps the 360px-first decision visible at every element.

## What it costs me

Verbose class strings in JSX. I contain that by extracting repeated patterns into components
rather than into `@apply` soup. And a reviewer who doesn't know Tailwind reads the markup more
slowly.

## Say this

> "Mobile-first from 360px, because that's a real device width for this audience, not a
> breakpoint I picked. And nothing about money is communicated by colour alone."
