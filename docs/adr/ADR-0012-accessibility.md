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
breakpoint. *(As built there is no confirm dialog: the review step is a page of the wizard. The dialogs that exist — the phone
menu and the Mock API panel — are native `<dialog>` elements, which trap focus and return it on close — ADR-0017.)*

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
`aria-required`, not only an asterisk. *(Not built: every field in the form is required, none shows an asterisk, and
`aria-required` is not set; a missing value is reported with an error on the field instead.)*

**Visible focus.** A `focus-visible` ring at 3:1 minimum contrast against its surface in both
themes. No `outline: none` anywhere in the codebase. *(As built, with two deliberate exceptions: elements focused only by
script — page and step headings, `<main>`, the table after a page change — use `focus:outline-none`, since they are
not controls and an outline there would look like a bug; and a text field's inner `<input>` has none because the
outline is drawn around the whole field box. The keyboard-only browser test checks each control it stops at shows
one.)*

**Not colour alone.** Covered in ADR 0010 — signs and text labels alongside the green/red.

**Amount announcement.** The amount field's accessible description announces the parsed value
back in words on blur ("one thousand naira, fifty kobo") so a screen reader user can confirm
what was understood before they reach the review step. Mis-keying an amount is the costliest
error in this app, and it is the error a sighted user catches by glancing. *(Not built. The amount is grouped while
typing and the review step shows it formatted in naira, which a screen reader reads out; reading it back in words on
the field is still open.)*

### Verification

- axe on every screen in component tests *(as built: `axe-core` via `src/test/axe.ts`, not `jest-axe`)*.
- Keyboard-only E2E traversal of the whole send flow.
- One manual pass with VoiceOver on the wizard and the feed, with findings recorded in the
  README. Automated tools catch roughly a third of real issues; the manual pass is where the
  virtualised-list problems surface.

### Implementation notes (Phase 9)

- **axe in a real browser:** `e2e/accessibility.spec.ts` injects the installed `axe-core` (no new dependency) and runs
  it against WCAG 2.1 A and AA on every page and the states listed in the README, in both themes, at 360px and 1440px —
  with colour contrast, which the jsdom component tests have to switch off. It passed on first run. To check it could
  fail at all: a low-contrast muted text colour, an icon button without its label, and route focus switched off were each
  made on purpose; each made the suite fail (`color-contrast`, `button-name`, the focus test), and each was reverted.
- **Keyboard-only Send Money** end to end, with Tab only: every control reached shows an outline on itself or, for a
  text field, around its box. Removing the global `:focus-visible` outline made it fail.
- **Route focus with pages loaded on demand:** the router's `lazy` routes load a page before the location changes, so
  `RouteFocus` still finds the new heading; the suite checks focus after each navigation in a real browser.
- **Not done: the VoiceOver pass** planned above. It needs a person listening; the checklist lists it as the owner's.
  Automated checks cover roughly a third of real issues, so this remains the largest gap.

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
