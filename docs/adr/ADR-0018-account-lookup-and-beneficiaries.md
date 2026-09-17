# ADR 0018 — Account name comes from a lookup, never from the merchant; recent recipients one tap away

**Status:** Accepted · **Date:** 2026-09-17

## Context

The first Send Money form asked the merchant to type the recipient's account name. The product owner rejected it, and
rightly: no Nigerian banking app does this. A typed name proves nothing. If a merchant mistypes one digit of an account
number, a typed name still looks correct, and the money goes to a stranger.

Real apps run a **name enquiry** (NIBSS, or a provider such as Paystack's `GET /bank/resolve`) as soon as a
10-digit number and a bank are entered, and show the holder's name for the merchant to confirm. Merchants also pay
the same suppliers again and again, so apps list recent recipients.

A real provider was considered and set aside by the product owner. Paystack's lookup needs a secret key, which
must never reach the browser, so it would need a proxy or a serverless function. The brief also asks us to own the
API layer and how it is faked.

## Decision

- **`GET /api/accounts/lookup?accountNumber=&bankCode=`** returns `{ accountNumber, bankCode, accountName }`, or
  `404 NOT_FOUND`. It is in the shared contract, so the app and the mock validate the same shapes. The name is untrusted
  text from another bank and is sanitised (ADR-0013).
- **The mock directory** (`src/mocks/directory.ts`) gives every well-formed account a stable, made-up holder
  derived from the bank and the number. A few fixed accounts are used by tests and seeded beneficiaries. **Numbers
  starting `999` do not exist**, so "no account found" can be shown on demand.
- **The server checks the name again.** `POST /api/transfers` refuses a name that does not match the holder
  (`VALIDATION_FAILED`, bound to the idempotency key like any rejection), and refuses an account that does not
  exist. The client showing the right name is a convenience; the server does not rely on it.
- **`GET /api/beneficiaries`** lists recent recipients, newest first. Accepting a transfer moves its recipient to the
  front. `sendMoney` invalidates the list only on success.
- **The form** looks the account up automatically once the number has 10 digits and a bank is chosen, with no button.
  It shows one of: verifying, the verified name, not found, or a failure with Retry. Continue is refused until the
  name is verified. The status region is mounted from the first render, so "Account verified: <name>" is announced.
- **Recent recipients** sit in a side panel from 1024px and in one row of avatars on phones. One tap fills the account
  number and bank, and the normal lookup then verifies them. They are shown masked (`••••6789`), per ADR-0015.
  The API returns the full number, because it is needed to pay the recipient again.

## Alternatives considered

**Paystack's resolve and bank-list endpoints.** Real names, real bank codes. Set aside by the product owner. It would
need a secret key kept server-side (a dev proxy or serverless function) and a fallback for reviewers without a key.

**Type the name, then check it on the server.** Rejected: the merchant would still be guessing, and a mismatch would
only surface after confirming.

**A "Verify" button.** An extra step every banking app has dropped. Looking up automatically is cached per account,
so going back and forward does not repeat it.

## Consequences

*What it buys:* a wrong digit shows the wrong name before any money moves, and a repeat payment is one tap.

*What it costs:* the mock has to invent believable names. Tests had to use accounts whose holders are known.

*The review step* is now the only place the full account number appears, next to the verified name, because that
pair is what the merchant is really confirming.

## How we would know we were wrong

- Merchants continue with the verified name without reading it. That calls for a stronger confirmation, such as
  typing the first letters of the name.
- A real provider's lookup is slow enough that auto-lookup feels laggy. That calls for a debounce and a visible
  "checking" state that holds its space.
