# ADR 0012 — Accessibility is built into the components, not audited at the end

**Status:** Accepted · **Date:** 2026-09-16

## Context

The brief requires WCAG AA basics: a keyboard-operable Send Money flow, visible focus states,
proper labels and aria attributes on form fields, and live regions for status updates.

Accessibility added at the end is remediation, and remediation on a virtualised list and a
multi-step wizard is expensive — both are structures that are hard to retrofit. The decision
is therefore about *when*, not only *what*.

## Decision

Accessibility requirements are part of each component's definition of done, enforced by tests
(ADR 0011), not by a pass at the end.

### Concrete commitments

**Semantics first.** Native `<button>`, `<table>`, `<form>`, `<dialog>` before any ARIA. Every
ARIA attribute in the codebase exists because no native element expressed the thing — the
`aria-rowindex` work in ADR 0008 is the main example.

**Focus management in the wizard.** On each step change, focus moves to the new step's
heading (`tabIndex={-1}`, focused programmatically). Without this, a keyboard or screen reader
user's focus is on a *Continue* button that has been unmounted, and they are returned to the
top of the document with no announcement. Focus order follows visual order at every
breakpoint. The confirm dialog traps focus and restores it to the trigger on close.

**Live regions, chosen deliberately.**

| Event | Region | Politeness |
|---|---|---|
| Transfer submitted | status | `polite` |
| Transfer settled | status | `polite` |
| Transfer failed | alert | `assertive` |
| Awaiting confirmation (ADR 0006) | alert | `assertive` |
| Page of transactions loaded | status | `polite` |
| Filter applied, N results | status | `polite` |

The regions are **present in the DOM from first render** and have their text swapped.
A live region inserted at the same moment as its content is frequently not announced — a
detail that is invisible in manual testing with a sighted developer's eyes and breaks the
requirement entirely.

**Forms.** Real `<label for>` on every field. Placeholders are never labels. Errors live in an
`aria-describedby` target with `aria-invalid` on the field. Required fields marked with
`aria-required`, not only an asterisk.

**Visible focus.** A `focus-visible` ring at 3:1 minimum contrast against its surface in both
themes. No `outline: none` anywhere in the codebase.

**Not colour alone.** Covered in ADR 0010 — signs and text labels alongside the green/red.

**Amount announcement.** The amount field's accessible description announces the parsed value
back in words on blur ("one thousand naira, fifty kobo") so a screen reader user can confirm
what was understood before they reach the review step. Mis-keying an amount is the costliest
error in this app, and it is the error a sighted user catches by glancing.

### Verification

- `jest-axe` on every screen in component tests.
- Keyboard-only E2E traversal of the whole send flow.
- One manual pass with VoiceOver on the wizard and the feed, with findings recorded in the
  README. Automated tools catch roughly a third of real issues; the manual pass is where the
  virtualised-list problems surface.

## Alternatives considered

**Audit at the end with axe DevTools.** Cheaper up front, and it produces a list of issues at
exactly the moment there is no time to fix structural ones.

**A component library with accessibility built in.** Rejected in ADR 0010 for the dashboard
as a whole; adopted narrowly via Radix primitives for the dialog and select, where the correct
behaviour is intricate and well-solved. *(Superseded by ADR-0017: a native `<dialog>` and a custom `Select` built to the
WAI-ARIA combobox pattern, with its keyboard and axe behaviour tested.)*

## Consequences

*What it buys:* the requirement is met structurally. USSD (`*894#`) exists in the NovaPay
product precisely because part of this user base has constrained access; a dashboard that
assumes a mouse and good eyesight contradicts the product it belongs to.

*What it costs:* slower initial component development, and focus management in the wizard is
genuinely fiddly code that needs its own test to stay correct.

## How we would know we were wrong

- The VoiceOver pass finds a class of issue the automated tests never flagged, meaning the
  tests are checking attributes rather than experience.
- Focus management breaks on a refactor without a test failing.
