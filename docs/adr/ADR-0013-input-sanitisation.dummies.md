# ADR-0013 in plain English — Input sanitisation

> Plain-language companion to **[ADR-0013](ADR-0013-input-sanitisation.md)**. Same decision, no jargon.
> **Interview weight: ⭐⭐ high** — the bidi point is genuinely impressive and almost nobody raises it.

## The problem

The brief: no unsanitised rendering of transaction descriptions or merchant-entered text — treat
it as untrusted.

## The bit most people miss

Everyone sanitises what the *merchant* types. But the sharper threat is the **counterparty's
account name** — text that arrived from a stranger, at another bank, through NIP.

**Someone can open a bank account with a chosen name and put arbitrary text on your screen.**
That's the interesting attack, and "sanitise the merchant's own note" doesn't cover it.

## What I did

**1. Let React escape everything.** All this text renders as a plain JSX text child. There is
**no `dangerouslySetInnerHTML` anywhere**, and an ESLint rule fails the build if anyone adds
one — with a test proving the rule actually fires. No rich text is needed
anywhere, so this costs nothing.

**2. Normalise at the API boundary** — one place, not at every render. Strip control characters,
strip zero-width characters, normalise Unicode, collapse whitespace, truncate at 140 chars.

**3. Never auto-link URLs.** Turning merchant-controlled text into a clickable link inside a
banking app is a phishing delivery mechanism.

## The impressive part — bidi overrides

React's escaping stops `<script>` from running. **It does not strip bidirectional override
characters** — invisible Unicode that reverses the direction text is displayed in.

Those can make `₦1,000 to Adebayo` *appear* to say something else entirely. In a payments UI,
that's a **spoofing vector**, not a cosmetic bug.

React is doing its job correctly here. Its job just isn't this. That distinction is worth
drawing explicitly — it shows you understand *why* the framework's protection stops where it
does, rather than just trusting it.

## The demo move

The seed data **deliberately includes hostile rows**: a `<script>` tag, an RTL override,
zero-width joiners, a 5,000-character description, an emoji-only one.

They're in the running app. **Scroll to them live** and show them rendering as harmless text.
That turns this from a claim into something the panel watches working.

## Why not the obvious alternative

**DOMPurify** is the right tool when you need to render HTML. I render none — so adding it
implies a capability I deliberately don't have. And it wouldn't address bidi anyway, since those
are valid text content, not markup.

**Sanitising at display time** — one missed call site is a hole. Normalising once at the API
boundary means every consumer gets safe data, including ones written later.

## What it costs me

A legitimate name with an unusual character could theoretically be altered. The normalisation is
conservative enough that this is unlikely for Nigerian names — Yoruba and Igbo diacritics are
preserved. The 140-character truncation is a real information loss, mitigated by showing the
full text in the transaction detail view.

## Say this

> "React's escaping handles script injection. It doesn't handle bidi overrides, which in a
> payments UI are a spoofing vector — so I normalise at the API boundary. And I seeded hostile
> rows so you can see it working rather than take my word for it."
