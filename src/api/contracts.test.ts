import { describe, it, expect } from 'vitest'
import {
  ApiErrorSchema,
  BalanceSchema,
  MIN_TRANSFER_KOBO,
  NARRATION_MAX_LENGTH,
  REJECTED_BY_CODE,
  SendMoneyRequestSchema,
  TransactionQuerySchema,
  TransactionSchema,
  type ErrorCode,
  type SendMoneyRequestWire,
  type TransactionWire,
} from './contracts'

const validTransaction: TransactionWire = {
  id: 'txn_000001',
  reference: 'NVB20260916000001',
  type: 'debit',
  status: 'successful',
  channel: 'transfer',
  amountKobo: 100050,
  description: 'Payment to Kano Grains Depot — rice supply',
  counterparty: { name: 'Kano Grains Depot', bankName: 'Zenith Bank', accountNumberLast4: '4821' },
  createdAt: '2026-09-16T09:30:00.000Z',
  idempotencyKey: '3f1c9a52-7b3e-4d2a-9c1e-5a6b7c8d9e0f',
  failureReason: null,
}

const validSend: SendMoneyRequestWire = {
  recipient: { accountNumber: '0123456789', bankCode: '058', accountName: 'Ngozi Okafor' },
  amountKobo: 100050,
  narration: 'Stock payment',
}

/** Parse and return the issue messages, or [] on success. */
const issues = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? [] : (result.error?.issues ?? []).map((i) => i.message)

describe('TransactionSchema', () => {
  it('accepts a valid transaction', () => {
    expect(TransactionSchema.safeParse(validTransaction).success).toBe(true)
  })

  it.each([
    ['zero', 0],
    ['negative', -100],
    ['a fraction', 1000.5],
    ['an unsafe integer', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects an amount that is %s', (_label, amountKobo) => {
    expect(TransactionSchema.safeParse({ ...validTransaction, amountKobo }).success).toBe(false)
  })

  it('rejects timestamps with an offset, so every timestamp compares correctly as a string', () => {
    expect(TransactionSchema.safeParse({ ...validTransaction, createdAt: '2026-09-16T10:30:00+01:00' }).success).toBe(false)
  })

  it.each([
    ['no fractional seconds', '2026-09-16T10:30:00Z'],
    ['one fractional digit', '2026-09-16T10:30:00.5Z'],
    ['microseconds', '2026-09-16T10:30:00.500000Z'],
  ])('rejects a timestamp with %s, which would mis-sort as a string', (_label, createdAt) => {
    expect(TransactionSchema.safeParse({ ...validTransaction, createdAt }).success).toBe(false)
  })

  it('why precision is fixed: mixed precision sorts the later instant first', () => {
    const earlier = '2026-09-16T10:30:00Z'
    const later = '2026-09-16T10:30:00.500Z'
    expect(Date.parse(later)).toBeGreaterThan(Date.parse(earlier))
    expect(later < earlier).toBe(true) // string order disagrees with time order
    expect(TransactionSchema.safeParse({ ...validTransaction, createdAt: new Date(later).toISOString() }).success).toBe(true)
  })

  it('requires failureReason exactly when the status is failed', () => {
    expect(TransactionSchema.safeParse({ ...validTransaction, status: 'failed' }).success).toBe(false)
    expect(TransactionSchema.safeParse({ ...validTransaction, failureReason: 'Declined' }).success).toBe(false)
    expect(
      TransactionSchema.safeParse({ ...validTransaction, status: 'failed', failureReason: 'Declined' }).success,
    ).toBe(true)
  })

  it('never carries a full account number — only the last four digits', () => {
    const tx = { ...validTransaction, counterparty: { ...validTransaction.counterparty, accountNumberLast4: '0123456789' } }
    expect(TransactionSchema.safeParse(tx).success).toBe(false)
  })

  it('rejects a malformed idempotency key', () => {
    expect(TransactionSchema.safeParse({ ...validTransaction, idempotencyKey: 'not-a-uuid' }).success).toBe(false)
  })
})

describe('SendMoneyRequestSchema — amount', () => {
  const withAmount = (amountKobo: number) => SendMoneyRequestSchema.safeParse({ ...validSend, amountKobo })

  it('accepts the minimum exactly', () => {
    expect(withAmount(MIN_TRANSFER_KOBO).success).toBe(true)
  })

  // The explicit > 0 rule. parseNairaInput accepts these by design, so this schema is what stops
  // them reaching the server. Each must produce exactly ONE message: the zero rule, not the minimum.
  it.each([
    ['zero', 0],
    ['negative kobo', -5],
    ['a negative thousand naira', -100_000],
  ])('rejects %s with a single "greater than zero" message', (_label, amountKobo) => {
    expect(issues(withAmount(amountKobo))).toEqual(['Enter an amount greater than zero'])
  })

  it('rejects an amount below the minimum with the minimum message', () => {
    expect(issues(withAmount(MIN_TRANSFER_KOBO - 1))).toEqual(['The minimum transfer is ₦100.00'])
  })

  it('rejects fractions of a kobo', () => {
    expect(withAmount(10_000.5).success).toBe(false)
  })
})

describe('SendMoneyRequestSchema — recipient and narration', () => {
  it.each(['012345678', '01234567890', '012345678a', ''])('rejects account number %j', (accountNumber) => {
    const req = { ...validSend, recipient: { ...validSend.recipient, accountNumber } }
    expect(SendMoneyRequestSchema.safeParse(req).success).toBe(false)
  })

  it('rejects a whitespace-only account name', () => {
    const req = { ...validSend, recipient: { ...validSend.recipient, accountName: '   ' } }
    expect(SendMoneyRequestSchema.safeParse(req).success).toBe(false)
  })

  it('rejects a narration over the length limit, and accepts one at it', () => {
    expect(SendMoneyRequestSchema.safeParse({ ...validSend, narration: 'x'.repeat(NARRATION_MAX_LENGTH + 1) }).success).toBe(false)
    expect(SendMoneyRequestSchema.safeParse({ ...validSend, narration: 'x'.repeat(NARRATION_MAX_LENGTH) }).success).toBe(true)
  })

  it('treats narration as optional', () => {
    const withoutNarration: SendMoneyRequestWire = { recipient: validSend.recipient, amountKobo: validSend.amountKobo }
    expect(SendMoneyRequestSchema.safeParse(withoutNarration).success).toBe(true)
  })
})

describe('untrusted text is sanitised as it is parsed (ADR-0013)', () => {
  const cp = (...codePoints: number[]) => String.fromCodePoint(...codePoints)

  it('strips a bidi override from a transaction description', () => {
    const parsed = TransactionSchema.parse({ ...validTransaction, description: `Refund ${cp(0x202e)}00.005${cp(0x202c)}` })
    expect(parsed.description).toBe('Refund 00.005')
  })

  it('strips zero-width characters from a counterparty name', () => {
    const tx = { ...validTransaction, counterparty: { ...validTransaction.counterparty, name: `Ngo${cp(0x200b)}zi` } }
    expect(TransactionSchema.parse(tx).counterparty.name).toBe('Ngozi')
  })

  it('rejects an account name made only of invisible characters — sanitised before the required check', () => {
    const req = { ...validSend, recipient: { ...validSend.recipient, accountName: cp(0x200b, 0xfeff, 0x202e) } }
    expect(SendMoneyRequestSchema.safeParse(req).success).toBe(false)
  })

  it('sanitises narration before its length check', () => {
    const padded = 'x'.repeat(NARRATION_MAX_LENGTH) + cp(0x200b).repeat(20)
    expect(SendMoneyRequestSchema.safeParse({ ...validSend, narration: padded }).success).toBe(true)
  })
})

describe('TransactionQuerySchema', () => {
  it('defaults the page size and coerces query-string values', () => {
    expect(TransactionQuerySchema.parse({}).limit).toBe(50)
    expect(TransactionQuerySchema.parse({ limit: '20' }).limit).toBe(20)
  })

  it('accepts a 1,000-row page, the largest rows-per-page option (ADR-0016)', () => {
    expect(TransactionQuerySchema.parse({ limit: '1000' }).limit).toBe(1000)
  })

  it.each(['0', '1001', 'abc', '2.5'])('rejects limit %j', (limit) => {
    expect(TransactionQuerySchema.safeParse({ limit }).success).toBe(false)
  })

  it('rejects an impossible calendar date', () => {
    expect(TransactionQuerySchema.safeParse({ from: '2026-02-30' }).success).toBe(false)
  })

  it('rejects a range that ends before it starts, and accepts a single-day range', () => {
    expect(TransactionQuerySchema.safeParse({ from: '2026-09-16', to: '2026-09-15' }).success).toBe(false)
    expect(TransactionQuerySchema.safeParse({ from: '2026-09-16', to: '2026-09-16' }).success).toBe(true)
  })

  it('rejects an unknown status', () => {
    expect(TransactionQuerySchema.safeParse({ status: 'reversed' }).success).toBe(false)
  })
})

describe('BalanceSchema', () => {
  const balance = {
    ledgerBalanceKobo: 500_000,
    availableBalanceKobo: 400_000,
    todayInflowKobo: 120_050,
    todayOutflowKobo: 0,
    asOf: '2026-09-16T09:30:00.000Z',
  }

  it('accepts a valid balance', () => {
    expect(BalanceSchema.safeParse(balance).success).toBe(true)
  })

  it('rejects negative daily totals', () => {
    expect(BalanceSchema.safeParse({ ...balance, todayInflowKobo: -1 }).success).toBe(false)
  })
})

describe('ApiErrorSchema — the rejected flag ADR-0006 depends on', () => {
  const error = (code: ErrorCode, rejected: boolean) => ({ error: { code, message: 'x', rejected } })

  it('refuses an INTERNAL_ERROR that claims nothing was written', () => {
    // If this parsed, the client would roll back a transfer that may have succeeded.
    expect(ApiErrorSchema.safeParse(error('INTERNAL_ERROR', true)).success).toBe(false)
  })

  it('refuses a validation failure that does not claim rejection', () => {
    expect(ApiErrorSchema.safeParse(error('VALIDATION_FAILED', false)).success).toBe(false)
  })

  it.each(Object.entries(REJECTED_BY_CODE) as [ErrorCode, boolean][])(
    'accepts %s with rejected=%s',
    (code, rejected) => {
      expect(ApiErrorSchema.safeParse(error(code, rejected)).success).toBe(true)
    },
  )
})
