# ADR-0017 in plain English — Our own dropdown, and the browser's own dialog

> Plain-language companion to **[ADR-0017](ADR-0017-custom-select-and-native-dialog.md)**. Same decision, no jargon.
> **Interview weight: ⭐ medium** — but be ready to defend "you built your own dropdown?"

## What changed

The plan ([ADR-0010](ADR-0010-styling-responsive.dummies.md)) said to use a library called **Radix** for the dialog and
the dropdowns. Neither ended up using it.

## The mobile menu: the browser does it now

The only dialog is the mobile navigation drawer. Modern browsers have a built-in `<dialog>` element that already traps
focus, closes on Escape, blocks the page behind it, and returns focus when it closes. A library would add nothing.

One catch: a very old browser without that feature still gets a menu that opens, but without the focus trap — keyboard
users could tab out of it behind the menu. Every major browser released since early 2022 has the feature.

## The dropdowns: built our own, carefully

The browser's own dropdown looked wrong — on a Mac it pops up a dark system menu inside a light app. The product owner
asked for a custom one.

**The risk:** a custom dropdown usually looks great and is useless without a mouse. So it follows the official W3C
pattern for exactly this widget. Arrow keys, Home/End, Enter, Escape, Tab and typing to jump all work, and the
ARIA roles and states a screen reader relies on are in place and tested. **Not yet done:** trying it with a real screen
reader (VoiceOver, TalkBack). Until then, "works with a screen reader" is the expected result, not a checked one.

## The part worth telling the panel

Writing the tests for it found **three real bugs** before anyone used it:
- typing the same letter twice was supposed to cycle through matches, and didn't — even though the code comment said it did;
- letters typed just before choosing leaked into the next search;
- the open menu sat outside the page's landmarks, which screen readers use to navigate.

## Why not just use Radix?

It's a good library. For **one** dropdown, it wasn't worth the extra download for merchants on metered data. If the app
grows a date picker or a searchable dropdown, that's the moment to switch.

## What we gave up

On a phone, the native dropdown opens the phone's own big picker. Ours doesn't.

## Say this

> "The browser's dialog does everything a library would, so I used it. For the dropdown I followed the W3C combobox
> pattern and tested every key and an axe run — and those tests caught three bugs, including one where the code comment
> claimed a behaviour the code didn't have."
