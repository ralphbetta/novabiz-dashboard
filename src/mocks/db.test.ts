import { describe, it, expect } from 'vitest'
import {
  BalanceSchema,
  SendMoneyRequestSchema,
  TransactionQuerySchema,
  TransactionsPageSchema,
  type SendMoneyRequestWire,
  type TransactionWire,
} from '../api/contracts'
import { startOfDay } from '../lib/time'
import { DEFAULT_SETTLEMENT_DELAY_MS, createMockDb, decodeCursor, encodeCursor, type MockDbOptions } from './db'
import { SEED_TRANSACTION_COUNT } from './seed'

const MID_MORNING = '2026-09-16T10:30:00.000Z'
const MIDNIGHT_WAT = '2026-09-15T23:00:00.000Z'

/** A db with a controllable clock. */
function setup(iso = MID_MORNING, options: Partial<MockDbOptions> = {}) {
  let current = new Date(iso).getTime()
  const db = createMockDb({ now: () => new Date(current), ...options })
  return { db, advance: (ms: number) => { current += ms } }
}

const query = (q: Record<string, string | number> = {}) => TransactionQuerySchema.parse(q)
const send = (overrides: Partial<SendMoneyRequestWire> = {}) =>
  SendMoneyRequestSchema.parse({
    recipient: { accountNumber: '0123456789', bankCode: '058', accountName: 'Ngozi Okafor' },
    amountKobo: 100_050,
    ...overrides,
  })
const KEY_A = '3f1c9a52-7b3e-4d2a-9c1e-5a6b7c8d9e0f'
const KEY_B = '9b2d4e61-1c3a-4f5b-8d7e-2a1b3c4d5e6f'

function unwrap<T>(result: { ok: true; value: T } | { ok: false; code: string; message: string }): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.message}`)
  return result.value
}

/** Walk every page and return the concatenated items. */
function walk(db: ReturnType<typeof setup>['db'], q: Record<string, string | number> = {}) {
  const all: TransactionWire[] = []
  let cursor: string | undefined
  for (let guard = 0; guard < 10_000; guard++) {
    const page = unwrap(db.listTransactions(query(cursor ? { ...q, cursor } : q)))
    all.push(...page.items)
    if (page.nextCursor === null) return all
    cursor = page.nextCursor
  }
  throw new Error('pagination did not terminate')
}

describe('balance', () => {
  it('matches the contract', () => {
    const { db } = setup()
    expect(BalanceSchema.safeParse(unwrap(db.getBalance())).success).toBe(true)
  })

  it('derives ledger, available and today totals from the transactions themselves', () => {
    const { db } = setup()
    const balance = unwrap(db.getBalance())
    const rows = walk(db, { limit: 100 })
    const dayStart = startOfDay(new Date(MID_MORNING)).toISOString()
    let ledger = 0, pendingDebits = 0, inflow = 0, outflow = 0
    for (const t of rows) {
      if (t.status === 'successful') {
        ledger += t.type === 'credit' ? t.amountKobo : -t.amountKobo
        if (t.createdAt >= dayStart && t.type === 'credit') inflow += t.amountKobo
        if (t.createdAt >= dayStart && t.type === 'debit') outflow += t.amountKobo
      }
      if (t.status === 'pending' && t.type === 'debit') pendingDebits += t.amountKobo
    }
    expect(balance).toMatchObject({
      ledgerBalanceKobo: ledger,
      availableBalanceKobo: ledger - pendingDebits,
      todayInflowKobo: inflow,
      todayOutflowKobo: outflow,
    })
    expect(balance.todayInflowKobo).toBeGreaterThan(0)
  })
})

describe('transaction listing', () => {
  it('returns the default page size, newest first, with the total count', () => {
    const { db } = setup()
    const page = unwrap(db.listTransactions(query()))
    expect(TransactionsPageSchema.safeParse(page).success).toBe(true)
    expect(page.items).toHaveLength(50)
    expect(page.totalCount).toBe(SEED_TRANSACTION_COUNT)
    expect(page.nextCursor).not.toBeNull()
  })

  it.each([
    ['mid-morning', 50, MID_MORNING],
    ['exactly midnight WAT, where today\'s rows all share one timestamp', 7, MIDNIGHT_WAT],
    ['exactly midnight WAT, with page boundaries falling inside the tied block', 4, MIDNIGHT_WAT],
  ] as const)('walks every row exactly once, in order, when opened %s (page size %i)', (_label, limit, iso) => {
    const { db } = setup(iso)
    const walked = walk(db, { limit })
    expect(walked).toHaveLength(SEED_TRANSACTION_COUNT)
    expect(new Set(walked.map((t) => t.id)).size).toBe(SEED_TRANSACTION_COUNT)
    const fullOrder = unwrap(db.listTransactions(query({ limit: 100 })))
    expect(walked.slice(0, 100).map((t) => t.id)).toEqual(fullOrder.items.map((t) => t.id))
  })

  it('confirms the midnight case really does put a page boundary inside tied timestamps', () => {
    const { db } = setup(MIDNIGHT_WAT)
    const page = unwrap(db.listTransactions(query({ limit: 4 })))
    const cursor = decodeCursor(page.nextCursor ?? '')
    const next = unwrap(db.listTransactions(query({ limit: 4, cursor: page.nextCursor ?? '' })))
    expect(cursor?.createdAt).toBe(next.items[0]?.createdAt) // same instant either side of the boundary
  })

  it('does not skip or repeat rows when a transfer is created between page requests', () => {
    const { db } = setup()
    const first = unwrap(db.listTransactions(query({ limit: 20 })))
    unwrap(db.createTransfer(send(), KEY_A))
    const second = unwrap(db.listTransactions(query({ limit: 20, cursor: first.nextCursor ?? '' })))
    const seen = [...first.items, ...second.items].map((t) => t.id)
    expect(new Set(seen).size).toBe(40)
    const reference = walk(setup().db, { limit: 40 }).slice(0, 40).map((t) => t.id)
    expect(seen).toEqual(reference)
  })

  it.each([
    ['status', { status: 'failed' }, (t: TransactionWire) => t.status === 'failed'],
    ['type', { type: 'credit' }, (t: TransactionWire) => t.type === 'credit'],
    ['status and type', { status: 'pending', type: 'debit' }, (t: TransactionWire) => t.status === 'pending' && t.type === 'debit'],
  ] as const)('filters by %s on the server, with totalCount across all pages', (_label, filter, predicate) => {
    const { db } = setup()
    const everything = walk(db, { limit: 100 })
    const filtered = walk(db, { ...filter, limit: 100 })
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.every(predicate)).toBe(true)
    expect(filtered).toHaveLength(everything.filter(predicate).length)
    expect(unwrap(db.listTransactions(query({ ...filter, limit: 1 }))).totalCount).toBe(filtered.length)
  })

  it('filters by an inclusive date range in business days (WAT)', () => {
    const { db } = setup()
    const today = walk(db, { from: '2026-09-16', to: '2026-09-16', limit: 100 })
    expect(today.length).toBeGreaterThan(0)
    // 2026-09-16 WAT is [2026-09-15T23:00Z, 2026-09-16T23:00Z)
    expect(today.every((t) => t.createdAt >= '2026-09-15T23:00:00.000Z' && t.createdAt < '2026-09-16T23:00:00.000Z')).toBe(true)
    const everythingToday = walk(db, { limit: 100 }).filter((t) => t.createdAt >= '2026-09-15T23:00:00.000Z')
    expect(today).toHaveLength(everythingToday.length)
  })

  it('returns an empty page, not an error, when nothing matches', () => {
    const { db } = setup()
    const page = unwrap(db.listTransactions(query({ from: '2020-01-01', to: '2020-01-31' })))
    expect(page).toEqual({ items: [], nextCursor: null, totalCount: 0 })
  })

  it.each(['garbage', encodeCursor({ createdAt: 'x', id: 'y' }).slice(0, 5), btoa('{"not":"a tuple"}')])(
    'rejects an invalid cursor %j',
    (cursor) => {
      const { db } = setup()
      expect(db.listTransactions(query({ cursor }))).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' })
    },
  )

  it('returns copies, so a caller cannot mutate server state', () => {
    const { db } = setup()
    const page = unwrap(db.listTransactions(query({ limit: 1 })))
    const first = page.items[0]
    if (!first) throw new Error('no rows')
    first.amountKobo = 1
    expect(unwrap(db.listTransactions(query({ limit: 1 }))).items[0]?.amountKobo).not.toBe(1)
  })
})

describe('creating a transfer', () => {
  it('creates a pending debit at the top of the feed and holds funds immediately', () => {
    const { db } = setup()
    const before = unwrap(db.getBalance())
    const { transfer, replayed } = unwrap(db.createTransfer(send({ amountKobo: 100_050 }), KEY_A))

    expect(replayed).toBe(false)
    expect(transfer).toMatchObject({
      type: 'debit', status: 'pending', amountKobo: 100_050, idempotencyKey: KEY_A,
      counterparty: { name: 'Ngozi Okafor', bankName: 'Guaranty Trust Bank', accountNumberLast4: '6789' },
    })
    expect(unwrap(db.listTransactions(query({ limit: 1 }))).items[0]?.id).toBe(transfer.id)

    const after = unwrap(db.getBalance())
    expect(after.availableBalanceKobo).toBe(before.availableBalanceKobo - 100_050)
    expect(after.ledgerBalanceKobo).toBe(before.ledgerBalanceKobo) // not settled yet
  })

  it('gives new transfers ids that sort after every seed id, so (createdAt, id) stays a total order', () => {
    const { db } = setup()
    const seedIds = walk(db, { limit: 100 }).map((t) => t.id)
    const { transfer } = unwrap(db.createTransfer(send(), KEY_A))
    expect(seedIds.every((id) => transfer.id > id)).toBe(true)
  })

  it('settles after the delay, then moves the ledger and today\'s outflow', () => {
    const { db, advance } = setup()
    const before = unwrap(db.getBalance())
    const { transfer } = unwrap(db.createTransfer(send({ amountKobo: 250_000 }), KEY_A))

    advance(DEFAULT_SETTLEMENT_DELAY_MS - 1)
    expect(unwrap(db.findTransferByKey(KEY_A)).status).toBe('pending')

    advance(1)
    expect(unwrap(db.findTransferByKey(KEY_A))).toMatchObject({ id: transfer.id, status: 'successful', failureReason: null })
    const after = unwrap(db.getBalance())
    expect(after.ledgerBalanceKobo).toBe(before.ledgerBalanceKobo - 250_000)
    expect(after.availableBalanceKobo).toBe(before.availableBalanceKobo - 250_000)
    expect(after.todayOutflowKobo).toBe(before.todayOutflowKobo + 250_000)
  })

  it('releases held funds when settlement fails', () => {
    const { db, advance } = setup(MID_MORNING, {
      settlementOutcome: () => ({ status: 'failed', reason: 'Beneficiary bank unavailable' }),
    })
    const before = unwrap(db.getBalance())
    unwrap(db.createTransfer(send({ amountKobo: 250_000 }), KEY_A))
    advance(DEFAULT_SETTLEMENT_DELAY_MS)
    expect(unwrap(db.findTransferByKey(KEY_A))).toMatchObject({ status: 'failed', failureReason: 'Beneficiary bank unavailable' })
    expect(unwrap(db.getBalance())).toMatchObject({
      ledgerBalanceKobo: before.ledgerBalanceKobo,
      availableBalanceKobo: before.availableBalanceKobo,
    })
  })

  it('rejects a transfer over the available balance without writing anything', () => {
    const { db } = setup()
    const before = unwrap(db.getBalance())
    const total = unwrap(db.listTransactions(query())).totalCount
    const result = db.createTransfer(send({ amountKobo: before.availableBalanceKobo + 1 }), KEY_A)
    expect(result).toMatchObject({ ok: false, code: 'INSUFFICIENT_FUNDS' })
    expect(unwrap(db.listTransactions(query())).totalCount).toBe(total)
    expect(unwrap(db.getBalance())).toEqual(before)
    // The rejection is bound to the key, so a lookup gives the conclusive answer, not an inconclusive miss.
    expect(db.findTransferByKey(KEY_A)).toMatchObject({ ok: false, code: 'INSUFFICIENT_FUNDS' })
  })

  it('accepts a transfer of exactly the available balance', () => {
    const { db } = setup()
    const { availableBalanceKobo } = unwrap(db.getBalance())
    expect(db.createTransfer(send({ amountKobo: availableBalanceKobo }), KEY_A).ok).toBe(true)
    expect(unwrap(db.getBalance()).availableBalanceKobo).toBe(0)
  })

  it('rejects an unknown bank code', () => {
    const { db } = setup()
    const request = send({ recipient: { accountNumber: '0123456789', bankCode: '999', accountName: 'Ngozi Okafor' } })
    expect(db.createTransfer(request, KEY_A)).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' })
  })
})

describe('idempotency (ADR-0007)', () => {
  it('a repeated key with the same payload creates exactly one ledger entry', () => {
    const { db } = setup()
    const total = unwrap(db.listTransactions(query())).totalCount
    const first = unwrap(db.createTransfer(send(), KEY_A))
    const second = unwrap(db.createTransfer(send(), KEY_A))
    const third = unwrap(db.createTransfer(send(), KEY_A))

    expect([second.replayed, third.replayed]).toEqual([true, true])
    expect(second.transfer.id).toBe(first.transfer.id)
    expect(third.transfer.id).toBe(first.transfer.id)
    expect(unwrap(db.listTransactions(query())).totalCount).toBe(total + 1)
    expect(walk(db, { limit: 100 }).filter((t) => t.idempotencyKey === KEY_A)).toHaveLength(1)
  })

  it('debits the balance once, however many times the request is retried', () => {
    const { db } = setup()
    const before = unwrap(db.getBalance()).availableBalanceKobo
    for (let i = 0; i < 5; i++) unwrap(db.createTransfer(send({ amountKobo: 100_000 }), KEY_A))
    expect(unwrap(db.getBalance()).availableBalanceKobo).toBe(before - 100_000)
  })

  it('a replay returns the transfer\'s current state, so a client retrying after a timeout learns it settled', () => {
    const { db, advance } = setup()
    unwrap(db.createTransfer(send(), KEY_A))
    advance(DEFAULT_SETTLEMENT_DELAY_MS)
    const replay = unwrap(db.createTransfer(send(), KEY_A))
    expect(replay).toMatchObject({ replayed: true, transfer: { status: 'successful' } })
  })

  it('refuses a reused key with a different payload, and writes nothing', () => {
    const { db } = setup()
    unwrap(db.createTransfer(send({ amountKobo: 100_000 }), KEY_A))
    const total = unwrap(db.listTransactions(query())).totalCount
    const balance = unwrap(db.getBalance())
    expect(db.createTransfer(send({ amountKobo: 999_900 }), KEY_A)).toMatchObject({ ok: false, code: 'IDEMPOTENCY_KEY_REUSED' })
    expect(unwrap(db.listTransactions(query())).totalCount).toBe(total)
    expect(unwrap(db.getBalance())).toEqual(balance)
    expect(unwrap(db.findTransferByKey(KEY_A)).amountKobo).toBe(100_000) // the original is untouched
  })

  it('treats a trimmed and an untrimmed account name as the same payload', () => {
    const { db } = setup()
    const a = unwrap(db.createTransfer(send({ recipient: { accountNumber: '0123456789', bankCode: '058', accountName: 'Ngozi Okafor' } }), KEY_A))
    const b = unwrap(db.createTransfer(send({ recipient: { accountNumber: '0123456789', bankCode: '058', accountName: '  Ngozi Okafor  ' } }), KEY_A))
    expect(b).toMatchObject({ replayed: true, transfer: { id: a.transfer.id } })
  })

  it('binds a rejection to its key: a new attempt after a confirmed failure needs a new key (ADR-0007)', () => {
    const { db } = setup()
    const { availableBalanceKobo } = unwrap(db.getBalance())
    expect(db.createTransfer(send({ amountKobo: availableBalanceKobo + 1 }), KEY_A)).toMatchObject({ ok: false, code: 'INSUFFICIENT_FUNDS' })
    // Same key, different (affordable) payload: a conflict, never a silent success.
    expect(db.createTransfer(send({ amountKobo: availableBalanceKobo }), KEY_A)).toMatchObject({ ok: false, code: 'IDEMPOTENCY_KEY_REUSED' })
    // A fresh key is a fresh intent, and proceeds.
    expect(db.createTransfer(send({ amountKobo: availableBalanceKobo }), KEY_B).ok).toBe(true)
  })

  it('keeps different keys independent', () => {
    const { db } = setup()
    const a = unwrap(db.createTransfer(send(), KEY_A))
    const b = unwrap(db.createTransfer(send(), KEY_B))
    expect(a.transfer.id).not.toBe(b.transfer.id)
  })
})

describe('reconciliation lookup (ADR-0006)', () => {
  it('finds a transfer by its idempotency key', () => {
    const { db } = setup()
    const { transfer } = unwrap(db.createTransfer(send(), KEY_A))
    expect(unwrap(db.findTransferByKey(KEY_A)).id).toBe(transfer.id)
  })

  it('reports NOT_FOUND for a key not yet received — inconclusive, since the request may still be in flight', () => {
    const { db } = setup()
    expect(db.findTransferByKey(KEY_B)).toMatchObject({ ok: false, code: 'NOT_FOUND' })
  })
})

describe('cursor encoding', () => {
  it('round-trips and is URL-safe', () => {
    const key = { createdAt: '2026-09-16T10:30:00.000Z', id: 'txn_01199abcdef01' }
    const encoded = encodeCursor(key)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeCursor(encoded)).toEqual(key)
  })
})
