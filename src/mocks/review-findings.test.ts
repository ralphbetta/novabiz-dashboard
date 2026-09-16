/**
 * Regression tests for the adversarial review of the mock API. Written BEFORE the fixes, to confirm
 * each finding against the unfixed code; kept afterwards so none can return.
 */
import { afterAll, afterEach, beforeAll, describe, it, expect } from 'vitest'
import { setupServer } from 'msw/node'
import {
  API, ApiErrorSchema, IDEMPOTENCY_HEADER, REJECTED_BY_CODE, SendMoneyRequestSchema,
  TransactionQuerySchema, TransactionsPageSchema, TransferResponseSchema, type SendMoneyRequestWire,
} from '../api/contracts'
import { DEFAULT_SETTLEMENT_DELAY_MS, createMockDb, type MockDbOptions } from './db'
import { createHandlers } from './handlers'

const NOW = '2026-09-16T10:30:00.000Z'
const KEY = '3f1c9a52-7b3e-4d2a-9c1e-5a6b7c8d9e0f'
const BASE = 'http://novabiz.test'
const transferWire: SendMoneyRequestWire = {
  recipient: { accountNumber: '0123456789', bankCode: '058', accountName: 'Ngozi Okafor' },
  amountKobo: 100_050,
}
const send = (o: Partial<SendMoneyRequestWire> = {}) => SendMoneyRequestSchema.parse({ ...transferWire, ...o })

function setupDb(options: Partial<MockDbOptions> = {}) {
  let current = new Date(NOW).getTime()
  const db = createMockDb({ now: () => new Date(current), ...options })
  return { db, advance: (ms: number) => { current += ms } }
}

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const post = (body: unknown, key: string) =>
  fetch(`${BASE}${API.transfers}`, { method: 'POST', headers: { 'Content-Type': 'application/json', [IDEMPOTENCY_HEADER]: key }, body: JSON.stringify(body) })
const lookup = (key: string) => fetch(`${BASE}${API.transfers}?idempotencyKey=${key}`)

describe('finding 1: a lookup miss must not claim nothing was written', () => {
  it('NOT_FOUND does not claim rejection', () => {
    expect(REJECTED_BY_CODE.NOT_FOUND).toBe(false)
  })

  it('a lookup sent while the POST is still in flight misses, says so without claiming rejection, and the transfer then lands', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { db } = setupDb()
    server.use(...createHandlers(db, { beforeProcessing: async (request) => { if (request.method === 'POST') await gate } }))

    const inFlight = post(transferWire, KEY) // not awaited: the server is "slow"
    const miss = await lookup(KEY)
    expect(miss.status).toBe(404)
    expect(ApiErrorSchema.parse(await miss.json()).error.rejected).toBe(false)

    release()
    expect((await inFlight).status).toBe(202)
    expect((await lookup(KEY)).status).toBe(200) // it existed after all
  })

  it('keys are case-insensitive: uppercase POST, lowercase lookup and retry', async () => {
    const { db } = setupDb()
    server.use(...createHandlers(db))
    const created = TransferResponseSchema.parse(await (await post(transferWire, KEY.toUpperCase())).json())
    expect((await lookup(KEY)).status).toBe(200)
    const retry = TransferResponseSchema.parse(await (await post(transferWire, KEY)).json())
    expect(retry.transfer.id).toBe(created.transfer.id)
  })
})

describe('finding 2: seed rows carrying idempotency keys', () => {
  const pendingSeedDebit = (db: ReturnType<typeof setupDb>['db']) => {
    const page = db.listTransactions(TransactionQuerySchema.parse({ status: 'pending', type: 'debit', limit: 100 }))
    if (!page.ok) throw new Error('list failed')
    const row = page.value.items.find((t) => t.idempotencyKey !== null)
    if (!row?.idempotencyKey) throw new Error('no pending seed debit with a key')
    return { ...row, idempotencyKey: row.idempotencyKey }
  }

  it('a pending seed debit visible in the feed can be found by its key', () => {
    const { db } = setupDb()
    const row = pendingSeedDebit(db)
    expect(db.findTransferByKey(row.idempotencyKey)).toMatchObject({ ok: true, value: { id: row.id } })
  })

  it('reusing a seed key for a new transfer writes nothing and does not claim rejection', () => {
    const { db } = setupDb()
    const row = pendingSeedDebit(db)
    const result = db.createTransfer(send(), row.idempotencyKey)
    expect(result).toMatchObject({ ok: false, code: 'IDEMPOTENCY_KEY_REUSED' })
    const all = db.listTransactions(TransactionQuerySchema.parse({ limit: 100 }))
    if (!all.ok) throw new Error('list failed')
    expect(all.value.items.filter((t) => t.idempotencyKey === row.idempotencyKey)).toHaveLength(1)
  })

  it('pending seed rows eventually settle rather than holding funds forever', () => {
    const { db, advance } = setupDb()
    const row = pendingSeedDebit(db)
    advance(60 * 60 * 1000)
    expect(db.findTransferByKey(row.idempotencyKey)).toMatchObject({ ok: true, value: { status: 'successful' } })
  })
})

describe('finding 3: a throwing settlement outcome', () => {
  it('does not strand the transfer, and does not break other requests meanwhile', () => {
    let calls = 0
    const { db, advance } = setupDb({
      settlementOutcome: () => { calls++; if (calls === 1) throw new Error('chaos hook bug'); return { status: 'successful' } },
    })
    const created = db.createTransfer(send(), KEY)
    expect(created.ok).toBe(true)
    advance(DEFAULT_SETTLEMENT_DELAY_MS)
    expect(db.getBalance().ok).toBe(true) // first settlement attempt throws here — must not take the balance down
    advance(60_000)
    expect(db.findTransferByKey(KEY)).toMatchObject({ ok: true, value: { status: 'successful' } })
  })
})

describe('finding 4: retries and 409', () => {
  it.each([['empty', ''], ['whitespace', '   ']])('an omitted narration and an %s narration are the same payload', (_label, narration) => {
    const { db } = setupDb()
    expect(db.createTransfer(send(), KEY).ok).toBe(true)
    expect(db.createTransfer(send({ narration }), KEY)).toMatchObject({ ok: true, value: { replayed: true } })
  })

  it('IDEMPOTENCY_KEY_REUSED does not claim rejection — a transfer exists under that key', () => {
    expect(REJECTED_BY_CODE.IDEMPOTENCY_KEY_REUSED).toBe(false)
  })
})

describe('extension of finding 1: a state-dependent rejection is bound to its key', () => {
  it('an insufficient-funds rejection is replayed for the same key, even after funds become available', () => {
    const OTHER_KEY = '9b2d4e61-1c3a-4f5b-8d7e-2a1b3c4d5e6f'
    const { db, advance } = setupDb({ settlementOutcome: () => ({ status: 'failed', reason: 'Beneficiary bank unavailable' }) })
    const bal = db.getBalance()
    if (!bal.ok) throw new Error('balance failed')
    const available = bal.value.availableBalanceKobo

    // Hold half the funds with another transfer, so KEY's transfer is unaffordable...
    const half = Math.floor(available / 2)
    expect(db.createTransfer(send({ amountKobo: half }), OTHER_KEY).ok).toBe(true)
    expect(db.createTransfer(send({ amountKobo: available }), KEY)).toMatchObject({ ok: false, code: 'INSUFFICIENT_FUNDS' })

    // ...then that transfer fails to settle and releases the funds. KEY's payload is now affordable.
    advance(DEFAULT_SETTLEMENT_DELAY_MS)
    const after = db.getBalance()
    expect(after.ok && after.value.availableBalanceKobo).toBe(available)

    // The key's outcome is fixed. If this succeeded, an original attempt still in flight could land
    // after the client had been told "nothing was written" and had rolled back.
    expect(db.createTransfer(send({ amountKobo: available }), KEY)).toMatchObject({ ok: false, code: 'INSUFFICIENT_FUNDS' })
  })

  it('a lookup of a key bound to a rejection returns that rejection — a conclusive answer', () => {
    const { db } = setupDb()
    const bal = db.getBalance()
    if (!bal.ok) throw new Error('balance failed')
    db.createTransfer(send({ amountKobo: bal.value.availableBalanceKobo + 1 }), KEY)
    expect(db.findTransferByKey(KEY)).toMatchObject({ ok: false, code: 'INSUFFICIENT_FUNDS' })
  })
})

describe('test gaps from the review', () => {
  it('replaying a transfer whose settlement failed returns its failed state and writes nothing', () => {
    const { db, advance } = setupDb({ settlementOutcome: () => ({ status: 'failed', reason: 'Beneficiary bank unavailable' }) })
    db.createTransfer(send(), KEY)
    advance(DEFAULT_SETTLEMENT_DELAY_MS)
    const before = db.listTransactions(TransactionQuerySchema.parse({}))
    expect(db.createTransfer(send(), KEY)).toMatchObject({ ok: true, value: { replayed: true, transfer: { status: 'failed' } } })
    const after = db.listTransactions(TransactionQuerySchema.parse({}))
    expect(after.ok && before.ok && after.value.totalCount).toBe(before.ok ? before.value.totalCount : -1)
  })

  it('pages through the whole feed over HTTP with no gaps or repeats', async () => {
    const { db } = setupDb()
    server.use(...createHandlers(db))
    const ids: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const qs: string = cursor ? `limit=100&cursor=${encodeURIComponent(cursor)}` : 'limit=100'
      const page = TransactionsPageSchema.parse(await (await fetch(`${BASE}${API.transactions}?${qs}`)).json())
      ids.push(...page.items.map((t) => t.id))
      cursor = page.nextCursor
      pages++
    } while (cursor !== null && pages < 100)
    expect(pages).toBe(12)
    expect(ids).toHaveLength(1200)
    expect(new Set(ids).size).toBe(1200)
  })
})
