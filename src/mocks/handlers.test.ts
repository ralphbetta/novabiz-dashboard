import { afterAll, afterEach, beforeAll, describe, it, expect } from 'vitest'
import { setupServer } from 'msw/node'
import {
  API,
  ApiErrorSchema,
  BalanceSchema,
  IDEMPOTENCY_HEADER,
  REJECTED_BY_CODE,
  TransactionsPageSchema,
  TransferResponseSchema,
  type ErrorCode,
  type SendMoneyRequestWire,
} from '../api/contracts'
import { DEFAULT_SETTLEMENT_DELAY_MS, createMockDb } from './db'
import { REPLAYED_HEADER, STATUS_BY_CODE, createHandlers } from './handlers'

const BASE = 'http://novabiz.test'
const KEY = '3f1c9a52-7b3e-4d2a-9c1e-5a6b7c8d9e0f'
const OTHER_KEY = '9b2d4e61-1c3a-4f5b-8d7e-2a1b3c4d5e6f'
const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

/** Fresh server state per test, with a controllable clock. */
function useMockApi() {
  let current = new Date('2026-09-16T10:30:00.000Z').getTime()
  server.use(...createHandlers(createMockDb({ now: () => new Date(current) })))
  return { advance: (ms: number) => { current += ms } }
}

const validTransfer: SendMoneyRequestWire = {
  recipient: { accountNumber: '0123456789', bankCode: '058', accountName: 'Ngozi Okafor' },
  amountKobo: 100_050,
}

const postTransfer = (body: unknown, key: string | null = KEY) =>
  fetch(`${BASE}${API.transfers}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key === null ? {} : { [IDEMPOTENCY_HEADER]: key }) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

/** Assert an error response is well-formed: right status, contract-valid body, consistent rejected flag. */
async function expectError(response: Response, code: ErrorCode) {
  expect(response.status).toBe(STATUS_BY_CODE[code])
  const parsed = ApiErrorSchema.safeParse(await response.json())
  expect(parsed.success, 'error body must satisfy ApiErrorSchema').toBe(true)
  if (!parsed.success) throw new Error('unreachable')
  expect(parsed.data.error.code).toBe(code)
  expect(parsed.data.error.rejected).toBe(REJECTED_BY_CODE[code])
  return parsed.data.error
}

describe('GET /api/balance', () => {
  it('returns a contract-valid balance', async () => {
    useMockApi()
    const response = await fetch(`${BASE}${API.balance}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(BalanceSchema.safeParse(await response.json()).success).toBe(true)
  })
})

describe('GET /api/transactions', () => {
  it('returns a contract-valid first page', async () => {
    useMockApi()
    const response = await fetch(`${BASE}${API.transactions}`)
    expect(response.status).toBe(200)
    const page = TransactionsPageSchema.parse(await response.json())
    expect(page.items).toHaveLength(50)
  })

  it('applies filters and page size from the query string, and follows the cursor', async () => {
    useMockApi()
    const first = TransactionsPageSchema.parse(await (await fetch(`${BASE}${API.transactions}?status=failed&limit=5`)).json())
    expect(first.items).toHaveLength(5)
    expect(first.items.every((t) => t.status === 'failed')).toBe(true)

    const url = `${BASE}${API.transactions}?status=failed&limit=5&cursor=${encodeURIComponent(first.nextCursor ?? '')}`
    const second = TransactionsPageSchema.parse(await (await fetch(url)).json())
    expect(second.items.every((t) => t.status === 'failed')).toBe(true)
    expect(second.items.map((t) => t.id)).not.toContain(first.items[0]?.id)
  })

  it.each([
    ['an out-of-range limit', 'limit=1001', 'limit'],
    ['an unknown status', 'status=reversed', 'status'],
    ['an impossible date', 'from=2026-02-30', 'from'],
    ['a reversed date range', 'from=2026-09-16&to=2026-09-01', 'to'],
    ['a malformed cursor', 'cursor=not-a-cursor', 'cursor'],
  ])('rejects %s with a field error', async (_label, qs, field) => {
    useMockApi()
    const error = await expectError(await fetch(`${BASE}${API.transactions}?${qs}`), 'VALIDATION_FAILED')
    expect(Object.keys(error.fieldErrors ?? {})).toContain(field)
  })
})

describe('POST /api/transfers', () => {
  it('accepts a transfer with 202 and a pending, contract-valid body', async () => {
    useMockApi()
    const response = await postTransfer(validTransfer)
    expect(response.status).toBe(202)
    expect(response.headers.get(REPLAYED_HEADER)).toBe('false')
    const { transfer } = TransferResponseSchema.parse(await response.json())
    expect(transfer).toMatchObject({ status: 'pending', amountKobo: 100_050, idempotencyKey: KEY })
  })

  it('replays a retried request: same status, same transfer, one ledger entry', async () => {
    useMockApi()
    const first = TransferResponseSchema.parse(await (await postTransfer(validTransfer)).json())
    const retry = await postTransfer(validTransfer)
    expect(retry.status).toBe(202)
    expect(retry.headers.get(REPLAYED_HEADER)).toBe('true')
    expect(TransferResponseSchema.parse(await retry.json()).transfer.id).toBe(first.transfer.id)

    const page = TransactionsPageSchema.parse(await (await fetch(`${BASE}${API.transactions}?limit=100`)).json())
    expect(page.items.filter((t) => t.idempotencyKey === KEY)).toHaveLength(1)
  })

  it('requires an Idempotency-Key header', async () => {
    useMockApi()
    await expectError(await postTransfer(validTransfer, null), 'VALIDATION_FAILED')
  })

  it('rejects an Idempotency-Key that is not a UUID', async () => {
    useMockApi()
    await expectError(await postTransfer(validTransfer, 'retry-1'), 'VALIDATION_FAILED')
  })

  it('rejects a body that is not JSON', async () => {
    useMockApi()
    await expectError(await postTransfer('{not json'), 'VALIDATION_FAILED')
  })

  it.each([
    ['zero', 0],
    ['negative', -500],
  ])('rejects a %s amount server-side with the contract\'s message', async (_label, amountKobo) => {
    useMockApi()
    const error = await expectError(await postTransfer({ ...validTransfer, amountKobo }), 'VALIDATION_FAILED')
    expect(error.fieldErrors?.amountKobo).toBe('Enter an amount greater than zero')
  })

  it('rejects insufficient funds with 422, flagged as nothing written', async () => {
    useMockApi()
    const { availableBalanceKobo } = BalanceSchema.parse(await (await fetch(`${BASE}${API.balance}`)).json())
    await expectError(await postTransfer({ ...validTransfer, amountKobo: availableBalanceKobo + 1 }), 'INSUFFICIENT_FUNDS')
  })

  it('rejects a reused key with a different payload with 409', async () => {
    useMockApi()
    await postTransfer(validTransfer)
    await expectError(await postTransfer({ ...validTransfer, amountKobo: 999_900 }), 'IDEMPOTENCY_KEY_REUSED')
  })
})

describe('unexpected server errors', () => {
  /** A db whose every method throws, standing in for any bug inside the mock server. */
  function useCrashingApi() {
    const db = createMockDb({ now: () => new Date('2026-09-16T10:30:00.000Z') })
    const crash = () => { throw new Error('simulated crash') }
    server.use(...createHandlers({ ...db, getBalance: crash, listTransactions: crash, createTransfer: crash, findTransferByKey: crash }))
  }

  it.each([
    ['GET balance', () => fetch(`${BASE}${API.balance}`)],
    ['GET transactions', () => fetch(`${BASE}${API.transactions}`)],
    ['POST transfer', () => postTransfer(validTransfer)],
    ['GET transfer by key', () => fetch(`${BASE}${API.transfers}?idempotencyKey=${KEY}`)],
  ])('%s: a crash becomes a contract-valid 500 that does NOT claim nothing was written', async (_label, request) => {
    useCrashingApi()
    const error = await expectError(await request(), 'INTERNAL_ERROR')
    // The ADR-0006 guarantee: the client must reconcile after a crash, never roll back.
    expect(error.rejected).toBe(false)
  })
})

describe('GET /api/transfers?idempotencyKey= — reconciliation', () => {
  it('returns the transfer\'s current state, including after settlement', async () => {
    const { advance } = useMockApi()
    await postTransfer(validTransfer)
    const lookup = () => fetch(`${BASE}${API.transfers}?idempotencyKey=${KEY}`)

    const pending = await lookup()
    expect(pending.status).toBe(200)
    expect(TransferResponseSchema.parse(await pending.json()).transfer.status).toBe('pending')

    advance(DEFAULT_SETTLEMENT_DELAY_MS)
    expect(TransferResponseSchema.parse(await (await lookup()).json()).transfer.status).toBe('successful')
  })

  it('returns 404 for a key never received', async () => {
    useMockApi()
    await expectError(await fetch(`${BASE}${API.transfers}?idempotencyKey=${OTHER_KEY}`), 'NOT_FOUND')
  })

  it('requires a valid idempotencyKey parameter', async () => {
    useMockApi()
    await expectError(await fetch(`${BASE}${API.transfers}`), 'VALIDATION_FAILED')
  })
})
