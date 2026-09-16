/**
 * The API contract, shared by the app and the mock server (ADR-0005, ADR-0009).
 *
 * Both sides import these exact schema objects, so client and server validation cannot drift.
 *
 * Every schema has two types:
 *   - `z.input<…>`  — the wire shape: plain JSON, amounts as plain integers. The mock produces this.
 *   - `z.output<…>` — the domain shape: amounts branded as `Kobo`. The app consumes this.
 * Parsing at the boundary is the only place a wire integer becomes a `Kobo`.
 */
import { z } from 'zod'
import { formatNaira, toKobo, type Kobo } from '../lib/money'

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const API = {
  balance: '/api/balance',
  transactions: '/api/transactions',
  transfers: '/api/transfers',
} as const

export const IDEMPOTENCY_HEADER = 'Idempotency-Key'

// ---------------------------------------------------------------------------
// Business rules
// ---------------------------------------------------------------------------

/**
 * ASSUMPTION — not from the brief. A plausible minimum for a merchant transfer, invented and
 * recorded as such in the README. Deliberately separate from the "> 0" rule below: if this were
 * ever lowered to zero, zero-value transfers must still be rejected.
 */
export const MIN_TRANSFER_KOBO: Kobo = toKobo(10_000) // ₦100.00

export const NARRATION_MAX_LENGTH = 100
export const PAGE_LIMIT_DEFAULT = 50
export const PAGE_LIMIT_MAX = 100

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** A non-negative amount in kobo. `z.int()` already rejects fractions and unsafe integers. */
const koboAmount = z.int({ error: 'Amount must be a whole number of kobo' }).min(0).transform(toKobo)

/** A signed amount in kobo, for balances. */
const signedKoboAmount = z.int({ error: 'Amount must be a whole number of kobo' }).transform(toKobo)

/**
 * UTC ISO-8601, `Z` suffix, exactly three fractional digits: `2026-09-16T10:30:00.000Z`.
 *
 * Both constraints exist so timestamps order correctly as plain strings, which newest-first sorting
 * and cursor pagination rely on. Offsets break it obviously. Variable precision breaks it subtly:
 * `"...10:30:00.500Z" < "...10:30:00Z"` is true, because `.` sorts before `Z`, although it is the
 * later instant. `Date.prototype.toISOString()` always emits exactly this form.
 */
const utcTimestamp = z.iso.datetime({ precision: 3, error: 'Timestamp must be ISO-8601 UTC with milliseconds' })

/** A NUBAN account number: exactly ten digits. */
const accountNumber = z.string().regex(/^\d{10}$/, 'Account number must be 10 digits')

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export const TransactionTypeSchema = z.enum(['credit', 'debit'])
export const TransactionStatusSchema = z.enum(['pending', 'successful', 'failed'])
export const ChannelSchema = z.enum(['transfer', 'qr', 'pos', 'ussd'])

export const CounterpartySchema = z.object({
  /** UNTRUSTED. Set by another bank's customer and arrives via NIP. See ADR-0013. */
  name: z.string(),
  bankName: z.string(),
  /**
   * Only the last four digits. The feed never needs the full number, so the API never sends it:
   * data minimisation under NDPA 2023 applied at the contract, not just hidden in the UI.
   */
  accountNumberLast4: z.string().regex(/^\d{4}$/),
})

export const TransactionSchema = z
  .object({
    id: z.string().min(1),
    /** What a merchant quotes to support or in a dispute. */
    reference: z.string().min(1),
    type: TransactionTypeSchema,
    status: TransactionStatusSchema,
    channel: ChannelSchema,
    /** A magnitude. Direction comes from `type` alone — see formatSignedNaira in ADR-0002. */
    amountKobo: z.int({ error: 'Amount must be a whole number of kobo' }).min(1).transform(toKobo),
    /** UNTRUSTED. See ADR-0013. */
    description: z.string(),
    counterparty: CounterpartySchema,
    createdAt: utcTimestamp,
    /** Present on merchant-initiated transfers, so an optimistic row can be matched (ADR-0006/7). */
    idempotencyKey: z.uuid().nullable(),
    failureReason: z.string().min(1).nullable(),
  })
  .superRefine((tx, ctx) => {
    if ((tx.status === 'failed') !== (tx.failureReason !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['failureReason'],
        message: 'failureReason must be present if and only if status is failed',
      })
    }
  })

export const TransactionsPageSchema = z.object({
  items: z.array(TransactionSchema),
  nextCursor: z.string().min(1).nullable(),
  /** Total matching the filters, across all pages. The virtualised feed needs it for aria-rowcount. */
  totalCount: z.int().min(0),
})

/**
 * Query string for GET /api/transactions. Every value arrives as a string, hence the coercion.
 * Dates are business calendar dates (WAT), inclusive at both ends — see src/lib/time.ts.
 */
export const TransactionQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce
      .number()
      .pipe(z.int().min(1).max(PAGE_LIMIT_MAX))
      .default(PAGE_LIMIT_DEFAULT),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    status: TransactionStatusSchema.optional(),
    type: TransactionTypeSchema.optional(),
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    path: ['to'],
    message: 'End date must not be before start date',
  })

// ---------------------------------------------------------------------------
// Balance
// ---------------------------------------------------------------------------

export const BalanceSchema = z.object({
  /** Settled funds only. */
  ledgerBalanceKobo: signedKoboAmount,
  /** Ledger minus pending debits: what the merchant can actually send. */
  availableBalanceKobo: signedKoboAmount,
  /** Successful credits since the start of the business day (src/lib/time.ts). */
  todayInflowKobo: koboAmount,
  /** Successful debits since the start of the business day (src/lib/time.ts). */
  todayOutflowKobo: koboAmount,
  asOf: utcTimestamp,
})

// ---------------------------------------------------------------------------
// Send Money
// ---------------------------------------------------------------------------

export const SendMoneyRequestSchema = z.object({
  recipient: z.object({
    accountNumber,
    bankCode: z.string().regex(/^\d{3,6}$/, 'Select a bank'),
    accountName: z.string().trim().min(1, 'Account name is required').max(100),
  }),
  amountKobo: z
    .int({ error: 'Amount must be a whole number of kobo' })
    // Explicit, and first. parseNairaInput accepts 0 and negatives by design (ADR-0002), so this
    // rule is what rejects them — independently of the minimum below. `abort` stops the minimum
    // from adding a second, redundant message for the same input.
    .refine((n) => n > 0, { error: 'Enter an amount greater than zero', abort: true })
    .refine((n) => n >= MIN_TRANSFER_KOBO, {
      error: `The minimum transfer is ${formatNaira(MIN_TRANSFER_KOBO)}`,
    })
    .transform(toKobo),
  /** UNTRUSTED merchant-entered text. See ADR-0013. */
  narration: z.string().trim().max(NARRATION_MAX_LENGTH).optional(),
})

/**
 * UUIDs are case-insensitive (RFC 9562), so keys are lowercased at the boundary. Otherwise a POST with
 * an uppercase key and a lookup with the lowercase form would miss each other.
 */
export const IdempotencyKeySchema = z
  .uuid({ error: 'Idempotency-Key must be a UUID' })
  .transform((key) => key.toLowerCase())

export const TransferResponseSchema = z.object({
  transfer: TransactionSchema,
})

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const ErrorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'INSUFFICIENT_FUNDS',
  'IDEMPOTENCY_KEY_REUSED',
  'NOT_FOUND',
  'INTERNAL_ERROR',
])
export type ErrorCode = z.output<typeof ErrorCodeSchema>

/**
 * Whether an error with this code proves that NO transfer exists under the request's idempotency key,
 * and that none ever will. This is the only signal that makes rolling back an optimistic transfer safe
 * (ADR-0006), so every `true` below is a promise the server must be able to keep:
 *
 *   VALIDATION_FAILED       true  — the request was refused before processing. Assumes the client never
 *                                   reuses a key for a different payload (ADR-0007).
 *   INSUFFICIENT_FUNDS      true  — and the rejection is BOUND to the key: every later request with that
 *                                   key gets the same answer, so an original attempt still in flight
 *                                   cannot land afterwards and succeed.
 *   IDEMPOTENCY_KEY_REUSED  false — a 409 is only possible because something already exists under the
 *                                   key. The client must look it up, never roll back.
 *   NOT_FOUND               false — a lookup miss proves nothing: the POST may still be in flight. The
 *                                   client keeps reconciling, never rolls back on a miss.
 *   INTERNAL_ERROR          false — a crash part-way through may have written something.
 *
 * Pinned per code, not left to each handler, so no call site can make a promise the server can't keep.
 */
export const REJECTED_BY_CODE = {
  VALIDATION_FAILED: true,
  INSUFFICIENT_FUNDS: true,
  IDEMPOTENCY_KEY_REUSED: false,
  NOT_FOUND: false,
  INTERNAL_ERROR: false,
} as const satisfies Record<ErrorCode, boolean>

export const ApiErrorSchema = z
  .object({
    error: z.object({
      code: ErrorCodeSchema,
      message: z.string().min(1),
      rejected: z.boolean(),
      fieldErrors: z.record(z.string(), z.string()).optional(),
    }),
  })
  .refine((body) => body.error.rejected === REJECTED_BY_CODE[body.error.code], {
    path: ['error', 'rejected'],
    message: 'rejected flag does not match the error code',
  })

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TransactionType = z.output<typeof TransactionTypeSchema>
export type TransactionStatus = z.output<typeof TransactionStatusSchema>
export type Channel = z.output<typeof ChannelSchema>

export type Transaction = z.output<typeof TransactionSchema>
export type TransactionWire = z.input<typeof TransactionSchema>
export type TransactionsPage = z.output<typeof TransactionsPageSchema>
export type TransactionsPageWire = z.input<typeof TransactionsPageSchema>
export type TransactionQuery = z.output<typeof TransactionQuerySchema>

export type Balance = z.output<typeof BalanceSchema>
export type BalanceWire = z.input<typeof BalanceSchema>

export type SendMoneyRequest = z.output<typeof SendMoneyRequestSchema>
export type SendMoneyRequestWire = z.input<typeof SendMoneyRequestSchema>
export type TransferResponse = z.output<typeof TransferResponseSchema>

export type ApiError = z.output<typeof ApiErrorSchema>
export type ApiErrorWire = z.input<typeof ApiErrorSchema>
