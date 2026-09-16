import { afterAll, afterEach, beforeAll, describe, it, expect } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { API, IDEMPOTENCY_HEADER, SendMoneyRequestSchema, type SendMoneyRequestWire } from './contracts'
import { novabizApi as api } from './novabizApi'
import { makeStore } from '../store'
import { REQUEST_NOT_SENT, isDefiniteFailure } from '../lib/errors'
import { TIMEOUT_HOLD_MS, createChaosController, type ChaosSettings } from '../mocks/chaos'
import { createMockDb } from '../mocks/db'
import { createHandlers } from '../mocks/handlers'

const BASE = 'http://novabiz.test'
const KEY = '3f1c9a52-7b3e-4d2a-9c1e-5a6b7c8d9e0f'
const wire: SendMoneyRequestWire = {
  recipient: { accountNumber: '0123456789', bankCode: '058', accountName: 'Ngozi Okafor' },
  amountKobo: 100_050,
}
const request = SendMoneyRequestSchema.parse(wire)

const server = setupServer()
const seen: { method: string; path: string; key: string | null }[] = []
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  server.events.on('request:start', ({ request: r }) => {
    seen.push({ method: r.method, path: new URL(r.url).pathname, key: r.headers.get(IDEMPOTENCY_HEADER) })
  })
})
afterEach(() => { server.resetHandlers(); seen.length = 0 })
afterAll(() => server.close())

const count = (method: string, path: string) => seen.filter((s) => s.method === method && s.path === path).length

/**
 * A store wired to the real mock server, with fast retries and a short client timeout so tests do not
 * wait for real backoff or the real 15s timeout. Chaos holds never release, standing in for a hang.
 */
function setup({
  chaos: settings = {},
  random = () => 0.99,
  serviceReady,
}: { chaos?: Partial<ChaosSettings>; random?: () => number; serviceReady?: Promise<void> } = {}) {
  const chaos = createChaosController({
    settings: { latencyMs: 0, jitterMs: 0, ...settings },
    random,
    sleep: (ms) => (ms === TIMEOUT_HOLD_MS ? new Promise<never>(() => {}) : Promise.resolve()),
  })
  const db = createMockDb({ now: () => new Date('2026-09-16T10:30:00.000Z'), settlementOutcome: chaos.settlementOutcome })
  server.use(...createHandlers(db, { chaos }))
  const store = makeStore({
    http: { baseUrl: BASE, timeoutMs: 100, retryBaseDelayMs: 1, retryMaxDelayMs: 2 },
    ...(serviceReady ? { serviceReady } : {}),
  })
  return { api, store, chaos }
}

describe('getBalance', () => {
  it('returns contract-valid data', async () => {
    const { api, store } = setup()
    const result = await store.dispatch(api.endpoints.getBalance.initiate())
    expect(result.error).toBeUndefined()
    expect(Number.isSafeInteger(result.data?.availableBalanceKobo)).toBe(true)
  })

  it('retries a 5xx on a read, then succeeds', async () => {
    // Five rolls per request (ROLLS_PER_REQUEST): jitter, timeout, error, commit, settlement.
    const rolls = [0, 0.99, 0, 0.99, 0.99, 0, 0.99, 0, 0.99, 0.99]
    let i = 0
    const { api, store } = setup({ chaos: { errorRate: 0.5 }, random: () => rolls[i++] ?? 0.99 })
    const result = await store.dispatch(api.endpoints.getBalance.initiate())
    expect(result.data).toBeDefined()
    expect(count('GET', API.balance)).toBe(3) // two 500s, then success
  })

  it('gives up after the retry limit: 1 attempt + 3 retries', async () => {
    const { api, store } = setup({ chaos: { errorRate: 1 }, random: () => 0 })
    const result = await store.dispatch(api.endpoints.getBalance.initiate())
    expect(result.error).toMatchObject({ status: 500 })
    expect(count('GET', API.balance)).toBe(4)
  })

  it('retries a read that times out, and reports TIMEOUT_ERROR when it keeps timing out', async () => {
    const { api, store } = setup({ chaos: { timeoutRate: 1 }, random: () => 0 })
    const result = await store.dispatch(api.endpoints.getBalance.initiate())
    expect(result.error).toMatchObject({ status: 'TIMEOUT_ERROR' })
    expect(count('GET', API.balance)).toBe(4)
  })

  it('rejects a response that fails the contract, and does not treat it as a definite failure', async () => {
    const { api, store } = setup()
    server.use(http.get(`*${API.balance}`, () => HttpResponse.json({ ledgerBalanceKobo: 1.5 })))
    const result = await store.dispatch(api.endpoints.getBalance.initiate())
    expect(result.data).toBeUndefined()
    expect(result.error).toBeDefined()
    expect(isDefiniteFailure(result.error)).toBe(false)
  })
})

describe('getTransactions — infinite, cursor-paginated, server-filtered', () => {
  it('fetches the first page, then appends the next', async () => {
    const { api, store } = setup()
    const first = await store.dispatch(api.endpoints.getTransactions.initiate({}))
    expect(first.data?.pages).toHaveLength(1)
    expect(first.data?.pages[0]?.items).toHaveLength(50)
    expect(first.data?.pages[0]?.totalCount).toBe(1200)

    const second = await store.dispatch(api.endpoints.getTransactions.initiate({}, { direction: 'forward' }))
    expect(second.data?.pages).toHaveLength(2)
    const ids = second.data?.pages.flatMap((p) => p.items.map((t) => t.id)) ?? []
    expect(new Set(ids).size).toBe(100)
  })

  it('reports no next page once the last page is loaded', async () => {
    const { api, store } = setup()
    const filters = { from: '2026-09-16', to: '2026-09-16' } // today only: fits on one page
    await store.dispatch(api.endpoints.getTransactions.initiate(filters))
    expect(api.endpoints.getTransactions.select(filters)(store.getState()).hasNextPage).toBe(false)
  })

  it('sends filters to the server, and keeps each filter set as a separate cache entry', async () => {
    const { api, store } = setup()
    const failed = await store.dispatch(api.endpoints.getTransactions.initiate({ status: 'failed' }))
    const credits = await store.dispatch(api.endpoints.getTransactions.initiate({ type: 'credit' }))
    expect(failed.data?.pages[0]?.items.every((t) => t.status === 'failed')).toBe(true)
    expect(credits.data?.pages[0]?.items.every((t) => t.type === 'credit')).toBe(true)
    expect(api.endpoints.getTransactions.select({ status: 'failed' })(store.getState()).data?.pages[0]?.totalCount)
      .toBe(failed.data?.pages[0]?.totalCount)
  })

  it('does not retry a 4xx', async () => {
    const { api, store } = setup()
    const result = await store.dispatch(api.endpoints.getTransactions.initiate({ from: '2026-02-30' }))
    expect(result.error).toMatchObject({ status: 400 })
    expect(count('GET', API.transactions)).toBe(1)
  })
})

describe('sendMoney — never retried (ADR-0014)', () => {
  it('sends the Idempotency-Key header and returns a contract-valid pending transfer', async () => {
    const { api, store } = setup()
    const result = await store.dispatch(api.endpoints.sendMoney.initiate({ request, idempotencyKey: KEY }))
    expect(result.data?.transfer).toMatchObject({ status: 'pending', amountKobo: 100_050, idempotencyKey: KEY })
    expect(seen.find((s) => s.method === 'POST')?.key).toBe(KEY)
  })

  it.each([
    ['error-before-commit', 500],
    ['error-after-commit', 500],
  ] as const)('%s: a 500 is sent exactly once, and is not a definite failure', async (outcome, status) => {
    const { api, store, chaos } = setup()
    chaos.forceNextTransfer(outcome)
    const result = await store.dispatch(api.endpoints.sendMoney.initiate({ request, idempotencyKey: KEY }))
    expect(result.error).toMatchObject({ status })
    expect(isDefiniteFailure(result.error)).toBe(false)
    expect(count('POST', API.transfers)).toBe(1)
  })

  it('timeout-after-commit: TIMEOUT_ERROR, sent once, not definite — and the transfer really exists  ⭐', async () => {
    const { api, store, chaos } = setup()
    chaos.forceNextTransfer('timeout-after-commit')
    const result = await store.dispatch(api.endpoints.sendMoney.initiate({ request, idempotencyKey: KEY }))
    expect(result.error).toMatchObject({ status: 'TIMEOUT_ERROR' })
    expect(isDefiniteFailure(result.error)).toBe(false)
    expect(count('POST', API.transfers)).toBe(1)

    const lookup = await store.dispatch(api.endpoints.getTransferByKey.initiate(KEY))
    expect(lookup.data?.transfer.idempotencyKey).toBe(KEY)
  })

  it('insufficient funds: a 422 that IS a definite failure, sent once', async () => {
    const { api, store } = setup()
    const tooMuch = SendMoneyRequestSchema.parse({ ...wire, amountKobo: 9_000_000_000_000 })
    const result = await store.dispatch(api.endpoints.sendMoney.initiate({ request: tooMuch, idempotencyKey: KEY }))
    expect(result.error).toMatchObject({ status: 422 })
    expect(isDefiniteFailure(result.error)).toBe(true)
    expect(count('POST', API.transfers)).toBe(1)
  })

  it('a reused key with a different payload: 409, not a definite failure', async () => {
    const { api, store } = setup()
    await store.dispatch(api.endpoints.sendMoney.initiate({ request, idempotencyKey: KEY }))
    const other = SendMoneyRequestSchema.parse({ ...wire, amountKobo: 200_000 })
    const result = await store.dispatch(api.endpoints.sendMoney.initiate({ request: other, idempotencyKey: KEY }))
    expect(result.error).toMatchObject({ status: 409 })
    expect(isDefiniteFailure(result.error)).toBe(false)
  })
})

describe('getTransferByKey', () => {
  it('a lookup miss is a 404 that is not a definite failure', async () => {
    const { api, store } = setup()
    const result = await store.dispatch(api.endpoints.getTransferByKey.initiate(KEY))
    expect(result.error).toMatchObject({ status: 404 })
    expect(isDefiniteFailure(result.error)).toBe(false)
  })
})

describe('waiting for the data service', () => {
  it('holds requests until the service is ready, then sends them', async () => {
    let markReady!: () => void
    const serviceReady = new Promise<void>((resolve) => { markReady = resolve })
    const { api, store } = setup({ serviceReady })

    const pending = store.dispatch(api.endpoints.getBalance.initiate())
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(count('GET', API.balance)).toBe(0) // nothing sent yet

    markReady()
    expect((await pending).data).toBeDefined()
    expect(count('GET', API.balance)).toBe(1)
  })

  it('refuses requests unsent, without retrying them, if the service never starts', async () => {
    const serviceReady = Promise.reject(new Error('insecure context'))
    const { api, store } = setup({ serviceReady })
    const result = await store.dispatch(api.endpoints.getBalance.initiate())
    expect(result.error).toMatchObject({ status: 'CUSTOM_ERROR', error: REQUEST_NOT_SENT })
    expect(count('GET', API.balance)).toBe(0)
  })
})
