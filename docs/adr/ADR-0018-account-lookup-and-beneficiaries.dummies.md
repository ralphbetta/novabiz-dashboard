# ADR-0018 in plain English — The app finds the account name; you pick people you've paid before

> Plain-language companion to **[ADR-0018](ADR-0018-account-lookup-and-beneficiaries.md)**. Same decision, no jargon.
> **Interview weight: ⭐⭐ high** — it's the difference between a form and a banking app.

## What was wrong

The first version asked the merchant to *type* the recipient's name. That proves nothing: mistype one digit of the
account number, type the name you expect, and the money goes to a stranger while everything on screen looks right.

## What happens now

1. You type the 10-digit account number and pick the bank.
2. The app immediately asks the bank "whose account is this?" and shows the name, e.g. **Ngozi Okafor ✓ Verified**.
3. If no such account exists, it says so and won't let you continue.
4. You can't type a name at all.

The server checks the name again when you send, so even a tampered app can't send to a mismatched account.

## Recent recipients

People you've paid before are listed beside the form (or as a row of avatars on a phone). Tap one and the number and
bank fill in, then get verified the same way. Only the last four digits are shown in that list. The full number
appears once, on the review screen, next to the verified name.

## "Why not a real bank API, like Paystack?"

It was considered. Paystack's lookup needs a **secret key**, and a secret key in a website can be read by anyone, so it
would need a small server to hide it. The brief asks us to build and fake the API ourselves, so the mock does it:
every account number gets a believable, repeatable name. Any number starting **999** "doesn't exist", so you can
show the error on demand.

## What we gave up

The names are made up. In a real app, this one endpoint would be swapped for the bank's name enquiry. The screens
wouldn't change.
