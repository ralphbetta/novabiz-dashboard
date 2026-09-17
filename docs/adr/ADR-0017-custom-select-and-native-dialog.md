# ADR 0017 — A custom Select and a native dialog, instead of Radix primitives

**Status:** Accepted · **Date:** 2026-09-17 · **Supersedes:** the Radix choice in ADR-0010 and ADR-0012

## Context

ADR-0010 planned to use unstyled Radix UI primitives for the dialog and the select, because correct focus trapping and
typeahead are hard to hand-roll. When the UI was built, two things were different from that plan:

- **The only dialog is the mobile navigation drawer.** The native `<dialog>` element, opened with `showModal()`, now
  provides the focus trap, Escape to close, an inert background and focus restoration in browsers that support
  `showModal()` (all major engines since early 2022).
- **The native `<select>` menu looked out of place.** Each platform draws its own popup; on macOS it is a dark system
  menu inside a light app. The product owner asked for a reusable custom dropdown.

The network during the build was also unreliable enough that every extra dependency cost real time, though that is a
reason to be careful, not the reason for the decision.

## Decision

- **Drawer:** the native `<dialog>` element with `showModal()`. No library. Where `showModal()` is missing, `AppShell`
  falls back to setting `open`, which shows the drawer **without** a focus trap, inert background or Escape handling.
  Kept deliberately: on such an engine a menu that opens without a trap is better than one that does not open.
- **Dropdown:** a single reusable `Select` component (`src/components/ui/Select.tsx`), built to the WAI-ARIA Authoring
  Practices **select-only combobox** pattern:
  - focus stays on the trigger (`role="combobox"`); the highlighted option is exposed with `aria-activedescendant`;
  - keyboard: ↓ ↑ Home End PageUp PageDown, Enter or Space to choose, Escape to close without changing the value, Tab to
    choose and move on, and typeahead (repeating a letter cycles through matches);
  - the list is portalled into the trigger's nearest landmark (`<main>`, or the dialog) with fixed positioning, so an
    `overflow: hidden` card cannot clip it, and it opens upward when there is no room below.
- It replaces every native `<select>`: Status, Date, and Rows per page.

## Alternatives considered

**Radix Select and Radix Dialog.** Well-tested and accessible. Rejected: the dialog adds nothing the native element does
not now provide, and one select component did not justify a dependency and its bundle weight for merchants on metered
data. Radix remains the right call if the app gains several complex widgets.

**Keep the native `<select>`.** The most robust option, with the phone's own picker on mobile. Rejected at the product
owner's request, and only because the replacement demonstrably keeps keyboard and screen-reader behaviour — see below.

**A custom dropdown without the ARIA pattern** (a styled `<div>` list). Rejected outright: it would look finished and be
unusable without a mouse.

## Consequences

*What it buys:* a dropdown that matches the app on every platform, in both themes, with no dependency.

*What it costs:* owning the accessibility of a widget the browser used to provide. That cost is paid in tests:
`Select.test.tsx` covers the semantics, every key, typeahead, pointer use and an axe run open and closed. Writing those
tests found three real bugs before they shipped — typeahead cycling did not work despite a comment saying it did, letters
typed before one choice prefixed the next search, and the open list sat outside every landmark.

*A regression the native element never had:* on mobile, the phone's own full-screen picker is gone.

*Not yet verified:* the combobox has not been tried with a real screen reader. Its roles, states and keyboard behaviour
are tested in jsdom and with axe, which is not the same as VoiceOver or TalkBack announcing it well.

## How we would know we were wrong

- A screen-reader pass (VoiceOver, TalkBack) finds the custom combobox harder to use than the native select was.
- The app needs a second complex widget (date picker, combobox with search): at that point adopt a primitives library
  rather than hand-roll another.
