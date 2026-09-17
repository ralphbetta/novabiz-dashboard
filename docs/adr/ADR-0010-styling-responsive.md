# ADR 0010 — Tailwind CSS, mobile-first from 360px, class-based dark mode

**Status:** Accepted; the Radix choice superseded by [ADR-0017](ADR-0017-custom-select-and-native-dialog.md) · **Date:** 2026-09-16

## Context

The dashboard must work from **360px to 1440px** and is stated to be genuinely used on low-end
Android phones. Dark mode with a persisted preference is a stretch goal. WCAG AA requires
contrast ratios of 4.5:1 for body text and visible focus indicators throughout.

360px is not a rounded-down guess — it is the width of the Galaxy A-series and Tecno/Infinix
devices that dominate this market. The layout must be designed at that width and expanded
upward, not designed at 1440px and squeezed.

## Decision

**Tailwind CSS**, authored **mobile-first** (unprefixed styles are the 360px case; `sm:`,
`lg:` add capability), with **class-based dark mode** (`darkMode: 'class'`) driven by the
persisted preference from ADR 0004.

### Design tokens over raw colours

Semantic tokens as CSS custom properties — `--color-surface`, `--color-text-primary`,
`--color-credit`, `--color-debit` — so dark mode is a token swap and not a second set of
utility classes on every element. Every token pair is checked against AA contrast in both
themes; the check is a unit test over the token values, not an eyeball.

### Money is never colour alone

Credits and debits are distinguished by an explicit `+` / `-` sign (hyphen-minus, per ADR-0002) and a text label, not only
by green and red. Roughly 8% of men have a red-green colour vision deficiency, and this is a
number a merchant acts on financially. Colour is reinforcement, never the signal. The same
applies to the `pending` / `successful` / `failed` badges, which carry text and an icon.

### Focus states

Tailwind's default focus ring is replaced with a token-driven `focus-visible` ring that meets
3:1 against both light and dark surfaces. Focus is never removed — not on the wizard buttons,
not on the virtualised rows, not on the theme toggle.

### Layout at each breakpoint

| Width | Layout |
|---|---|
| 360–639px | Single column. Balance card stacks. Feed rows are two-line. Send Money is full-screen. Filters collapse into a sheet. |
| 640–1023px | Two-column balance summary. Feed rows single-line. Filters become an inline bar. |
| 1024px+ | Persistent sidebar navigation. Send Money becomes a side panel beside the feed rather than a full-screen takeover. |

Tap targets are a minimum of 44×44px at every width.

## Alternatives considered

**CSS Modules.** No build-time class generation, full CSS power, and it scatters the
responsive story across many files. Tailwind keeps the 360px-first decision visible at every
element, which is exactly the constraint most likely to be violated by accident.

**styled-components / Emotion.** Runtime cost on a low-end device, for a styling problem that
does not need runtime dynamism.

**A component library (MUI, Chakra, Ant).** The fastest route to a screen that looks finished,
and it would obscure the assessment — the panel is grading component boundaries and
accessibility, and a library answers both on our behalf. It also ships a large bundle to an
audience we have specifically decided to be careful with. We use **Radix UI primitives**
(unstyled) for the dialog and select, because correct focus-trap and typeahead behaviour is
genuinely hard to hand-roll and is not what is being assessed. *(Superseded: see ADR-0017.)*

## Consequences

*What it buys:* the 360px case is the default case, so it cannot be forgotten. Dark mode is a
token file. No runtime styling cost. Purged CSS is small.

*What it costs:* verbose class strings in JSX, which we contain by extracting repeated
patterns into components rather than into `@apply` soup. A reviewer unfamiliar with Tailwind
reads markup more slowly.

## Implementation notes

Recorded while building Phase 4, where the implementation differs in detail from the text above:

- **Tailwind v4, set up as its official Vite guide describes:** the `@tailwindcss/vite` plugin in `vite.config.ts` and
  `@import "tailwindcss"` in CSS. There is no `tailwind.config.js` and no PostCSS config. v3's `darkMode: 'class'`
  becomes `@custom-variant dark (&:where(.dark, .dark *))` in CSS.
- **Tokens:** colours are `--nb-*` variables on `:root`, redefined under `.dark`, and exposed as utilities through
  `@theme inline` — Tailwind's docs require `inline` when a theme value references a variable that changes. Tailwind's
  default palette is removed (`--color-*: initial`), so components can only reach the semantic tokens.
- **The token contrast test** is [src/styles/tokens.test.ts](../../src/styles/tokens.test.ts): text pairs at 4.5:1 and
  focus outlines, field borders and hover/open borders at 3:1, in both themes. The pairs are listed by hand from the
  components; the test does not work out which colours overlap. It does compile the CSS Tailwind generates for the
  codebase and fail if a text or background colour in use is missing from every pair. On first run
  it found the light-mode focus outline at **2.3:1 on the brand blue** (sidebar, drawer, balance card). Fixed with a
  `surface-brand` utility that sets the background and switches the outline to `focus-on-brand`; the test also fails
  if anything else in the generated CSS paints the brand blue. The resting control border below is pinned as a known
  exception.
- **Radix was not used.** See ADR-0017: the drawer is a native `<dialog>`, and the dropdowns are a custom `Select`.
- **The layout became a routed dashboard** at the product owner's request: a sidebar from 1024px and a drawer below it,
  and separate routes for the dashboard, transactions and send money. Send Money is its own page, not a side panel.
- **Control borders are a light tint** (`border-control`, `#d3dae4` light / `#2e3b54` dark) at the product owner's
  request, darkening to `border-strong` on hover. On its own that border does not meet WCAG's 3:1 non-text contrast for
  control boundaries. It is limited to buttons and dropdowns, which always show text — a label, or a current value and
  chevron (about 7.5:1) — and WCAG 1.4.11 does not require a boundary where text identifies the control. **Inputs are
  different:** an empty date field has no text or chevron, so its border is the only sign it is there. Inputs use
  `border-field` (`#878f9c` / `#5f6d86`, at least 3:1), and a test fails if the tinted border is used outside
  `Button` and `Select`. The first version used the tinted border on the date inputs too; review caught it.
- **No shadows on cards or tables**, at the product owner's request. Borders separate surfaces; the open dropdown keeps a
  shadow, because it floats above content.
- **Two Tailwind pitfalls met in practice.** Overriding a button's text colour through `className` silently lost to the
  variant's colour, because in v4 the utility later in the generated stylesheet wins, whatever the class order — colours
  now come only from variants. And `not-sr-only` resets padding to 0, which misaligned the table header until the padding
  moved to an inner element.

## How we would know we were wrong

- A contrast check fails in one theme after a token change — caught by the token test.
- Class strings grow long enough that the markup stops being readable, indicating the
  component boundary is wrong rather than the styling approach.
