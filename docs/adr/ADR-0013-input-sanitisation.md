# ADR 0013 — All merchant- and counterparty-supplied text is untrusted

**Status:** Accepted · **Date:** 2026-09-16

## Context

The brief: no unsanitized rendering of transaction descriptions or merchant-entered text —
treat it as untrusted input.

In this app the untrusted surface is wider than it first looks. It is not only the note a
merchant types. A transaction description can carry a **counterparty's** account name, which
is text that arrived from another bank, through NIP, from a person with no relationship to us.
An attacker who can open an account with a chosen name can put arbitrary text into our UI.
That is the interesting threat, and it is the one a "sanitise the merchant's own note" reading
misses.

## Decision

**1. Default to React's own escaping.** All such text renders as a JSX text child. React
escapes it. There is **no `dangerouslySetInnerHTML` in this codebase**, and an ESLint
`no-restricted-syntax` rule matching the JSX attribute makes adding one a build failure rather
than a review comment. It needs no React lint plugin, and a test asserts it fires. No
rich text is required anywhere, so this costs nothing.

**2. Normalise on the way in, not on the way out.** At the API boundary, transaction
descriptions and counterparty names are passed through a normaliser that:

- strips **C0/C1 control characters** and zero-width characters (`U+200B`–`U+200D`, `U+FEFF`);
- strips **bidirectional override characters** (`U+202A`–`U+202E`, `U+2066`–`U+2069`);
- applies **NFC Unicode normalisation**;
- collapses runs of whitespace;
- truncates to 140 characters with an ellipsis.

The bidi item is the one that matters and the one that is almost always missed. React escaping
prevents script execution but does **not** prevent a right-to-left override from making
`₦1,000.00 to Adebayo` render as something with a different apparent recipient or amount. In a
payments UI that is a spoofing vector, not a cosmetic issue. React is doing its job correctly;
its job is not this.

**3. URLs are not rendered as links.** Descriptions are rendered as plain text even when they
contain a URL. Auto-linking merchant-controlled text into a clickable destination inside a
banking app is a phishing delivery mechanism.

**4. `rel="noopener noreferrer"` and a scheme allowlist** on the few genuinely external links
that exist, rejecting `javascript:` and `data:`.

**5. Server-side too.** The mock API applies the same normaliser on write, and the seed data
**deliberately includes hostile rows** — a description containing `<script>alert(1)</script>`,
one with an RTL override, one with zero-width joiners, one 5,000 characters long. They are
visible in the running app, which turns this ADR from a claim into something the panel can see
working. A component test asserts each renders as inert, visible text *(added in Phase 9, when review found the claim had no
test behind it: `src/features/transactions/TransactionRow.test.tsx` parses each hostile value through the contract and
renders the row; rendering the description as HTML, or not stripping format characters, makes it fail)*.

## Alternatives considered

**DOMPurify.** The right tool when HTML must be rendered. We render none, so adding it would
be a dependency that implies a capability we deliberately do not have — and the normalisation
above addresses a threat DOMPurify does not, since bidi characters are valid text content.

**Sanitising only on display.** One missed call site is a hole. Normalising at the single API
boundary means every consumer gets safe data, including future ones.

**Trusting the backend.** The backend does not exist yet, and the counterparty-name vector
means the data is not really ours even when it does.

## Consequences

*What it buys:* XSS is structurally impossible rather than defended against, and the subtler
spoofing vector is closed. A reviewer can `grep dangerouslySetInnerHTML` and get nothing.

*What it costs:* a legitimate name containing an unusual but valid character could be altered
by normalisation. NFC plus a control-character strip is conservative enough that this is
unlikely for Nigerian names, including Yoruba and Igbo diacritics, which NFC preserves. The
truncation at 140 characters is a real information loss. *(The planned mitigation — the full text in a transaction
detail view — was not built: there is no detail view, and text is cut to 140 characters at the API boundary.)*

## How we would know we were wrong

- A legitimate counterparty name renders incorrectly after normalisation.
- A requirement appears for formatted text in descriptions, at which point DOMPurify plus a
  strict allowlist replaces the blanket ban, and this ADR is superseded.
