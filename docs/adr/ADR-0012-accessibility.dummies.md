# ADR-0012 in plain English — Accessibility

> Plain-language companion to **[ADR-0012](ADR-0012-accessibility.md)**. Same decision, no jargon.
> **Interview weight: ⭐ medium** — but two details below make you sound like you've done this before.

## The problem

WCAG AA basics: keyboard-operable Send Money, visible focus states, proper labels and aria
attributes, live regions for status updates.

## The decision is about *when*, not just *what*

Accessibility added at the end is remediation — and you find the structural problems at exactly
the moment there's no time to fix them. A **virtualised list** and a **multi-step wizard** are
the two hardest things to retrofit, and this app has both.

So: accessibility is part of each component's definition of done, enforced by tests.

## Two details that show experience

**1. Focus has to move when the wizard step changes.**

When step 2 unmounts, a keyboard user's focus is sitting on a *Continue* button that no longer
exists. The browser dumps them at the top of the document with no announcement. So focus moves
programmatically to the new step's heading.

**2. Live regions must already be in the DOM, empty, before you need them.**

If you insert the region *and* its content at the same moment, screen readers frequently don't
announce it at all. So the regions are rendered from the start and have their text swapped in.

This is completely invisible if you only test with your eyes — which is why it's worth
mentioning.

## The politeness levels are deliberate

| Event | Politeness |
|---|---|
| Transfer submitted / settled | `polite` — don't interrupt |
| Transfer **failed** | `assertive` — interrupt |
| **Awaiting confirmation** | `assertive` — interrupt |
| Page of transactions loaded | `polite` |

## The nice touch

On blur, the amount field announces the parsed value back: *"one thousand naira, fifty kobo."*

Mis-keying an amount is the costliest error in this app, and it's the one a sighted user catches
at a glance. This gives a screen reader user the same chance.

## Why not the obvious alternative

**Audit at the end with axe DevTools** — cheaper up front, and it produces a list of structural
problems on the last day.

**A component library with a11y built in** — rejected for the app as a whole in
[ADR-0010](ADR-0010-styling-responsive.dummies.md). The first plan still used Radix for the dialog and select, where the
correct behaviour is intricate. That changed: the app now uses the browser's own dialog and a tested custom dropdown
instead — see [ADR-0017](ADR-0017-custom-select-and-native-dialog.dummies.md).

## How I verified it

`jest-axe` on every screen, keyboard-only E2E traversal of the send flow, and **one manual pass
with VoiceOver** with the findings written into the README. Automated tools catch roughly a
third of real issues — the manual pass is where the virtualised-list problems actually surface.

## What it costs me

Slower initial component development, and the wizard's focus management is genuinely fiddly code
that needs its own test to stay correct.

## Say this

> "It's built in rather than audited at the end, because a virtualised list and a multi-step
> wizard are the two hardest things to retrofit. And this product has a USSD channel precisely
> because part of this user base has constrained access — a dashboard that assumes a mouse and
> good eyesight contradicts the product it belongs to."
