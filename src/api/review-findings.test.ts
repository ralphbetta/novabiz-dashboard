/**
 * Regression tests for the adversarial review of the Phase 3 data layer. Written BEFORE the fixes, to
 * confirm each finding against the unfixed code; kept afterwards so none can return.
 */
import { afterAll, afterEach, beforeAll, describe, it, expect } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { API, SendMoneyRequestSchema } from './contracts'
import { novabizApi as api } from './novabizApi'
import { makeStore } from '../store'
import { isDefiniteFailure } from '../lib/errors'
import { TIMEOUT_HOLD_MS, createChaosController, type ChaosSettings } from '../mocks/chaos'
import { DEFAULT_SETTLEMENT_DELAY_MS, createMockDb } from '../mocks/db'
import { createHandlers } from '../mocks/handlers'

const BASE = 'http://novabiz.test'
const KEY = '3f1c9a52-7b3e-4d2a-9c1e-5a6b7c8d9e0f'
const request = SendMoneyRequestSchema.parse({
  recipient: { accountNumber: '0123456789', bankCode: '058', accountName: 'Ngozi Okafor' },
  amountKobo: 100_050,
})
const FAST = { baseUrl: BASE, timeoutMs: 100, retryBaseDelayMs: 1, retryMaxDelayMs: 2 }

const server = setupServer()
const seen: { method: string; path: string }[] = []
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  server.events.on('request:start', ({ request: r }) => { seen.push({ method: r.method, path: new URL(r.url).pathname }) })
})
afterEach(() => { server.resetHandlers(); seen.length = 0 })
afterAll(() => server.close())
const count = (method: string, path: string) => seen.filter((s) => s.method === method && s.path === path).length

function mockServer(chaosSettings: Partial<ChaosSettings> = {}, random = () => 0.99) {
  let current = new Date('2026-09-16T10:30:00.000Z').getTime()
  const chaos = createChaosController({
    settings: { latencyMs: 0, jitterMs: 0, ...chaosSettings },
    random,
    sleep: (ms) => (ms === TIMEOUT_HOLD_MS ? new Promise<never>(() => {}) : Promise.resolve()),
  })
  const db = createMockDb({ now: () => new Date(current), settlementOutcome: chaos.settlementOutcome })
  server.use(...createHandlers(db, { chaos }))
  return { chaos, advance: (ms: number) => { current += ms } }
}

describe('finding 1: writes are never retried, even when an endpoint forgets to opt out', () => {
  it('a new POST endpoint without maxRetries: 0 is sent once on a 503', async () => {
    const withWrite = api.injectEndpoints({
      endpoints: (build) => ({
        unguardedWrite: build.mutation<unknown, void>({ query: () => ({ url: '/api/unguarded-write', method: 'POST' }) }),
      }),
    })
    server.use(http.post('*/api/unguarded-write', () => HttpResponse.json({}, { status: 503 })))
    const store = makeStore({ http: FAST })
    await store.dispatch(withWrite.endpoints.unguardedWrite.initiate())
    expect(count('POST', '/api/unguarded-write')).toBe(1)
  })
})

describe('finding 2: the reconciliation lookup always asks the server', () => {
  it('two lookups for the same key send two requests, and the second sees the settled state', async () => {
    const { advance } = mockServer()
    const store = makeStore({ http: FAST })
    await store.dispatch(api.endpoints.sendMoney.initiate({ request, idempotencyKey: KEY }))

    const first = await store.dispatch(api.endpoints.getTransferByKey.initiate(KEY)) // subscription kept
    expect(first.data?.transfer.status).toBe('pending')

    advance(DEFAULT_SETTLEMENT_DELAY_MS)
    const second = await store.dispatch(api.endpoints.getTransferByKey.initiate(KEY))
    expect(count('GET', API.transfers)).toBe(2)
    expect(second.data?.transfer.status).toBe('successful')
  })
})

describe('finding 3: a slow start recovers once the service comes up', () => {
  it('a request made after a late start succeeds, even though an earlier wait timed out', async () => {
    mockServer()
    let markReady!: () => void
    const startup = new Promise<void>((resolve) => { markReady = resolve })
    const store = makeStore({ http: FAST, serviceReady: startup, serviceWaitMs: 20 })

    const earlyRequest = store.dispatch(api.endpoints.getBalance.initiate())
    const early = await earlyRequest
    expect(early.error).toBeDefined() // timed out waiting: expected
    earlyRequest.unsubscribe()

    markReady() // the service comes up late
    const later = await store.dispatch(api.endpoints.getBalance.initiate(undefined, { forceRefetch: true }))
    expect(later.data).toBeDefined()
  })
})

describe('finding 4: a transfer that never left the device is a definite failure', () => {
  it('sendMoney during a failed startup is never sent, and is safe to roll back', async () => {
    mockServer()
    const store = makeStore({ http: FAST, serviceReady: Promise.reject(new Error('worker failed')) })
    const result = await store.dispatch(api.endpoints.sendMoney.initiate({ request, idempotencyKey: KEY }))
    expect(count('POST', API.transfers)).toBe(0)
    expect(isDefiniteFailure(result.error)).toBe(true)
  })
})

describe('finding 5: the API the hooks use can be configured by the store', () => {
  it('the shared novabizApi picks up the test store\'s base URL and retry timing', async () => {
    mockServer()
    const store = makeStore({ http: FAST })
    const result = await store.dispatch(api.endpoints.getBalance.initiate())
    expect(result.data).toBeDefined()
  }, 5_000)
})

describe('finding 7: reconnecting does not reload every page of a long scroll', () => {
  it('a reconnect refetches only the first page', async () => {
    mockServer()
    const store = makeStore({ http: FAST })
    await store.dispatch(api.endpoints.getTransactions.initiate({}))
    await store.dispatch(api.endpoints.getTransactions.initiate({}, { direction: 'forward' }))
    await store.dispatch(api.endpoints.getTransactions.initiate({}, { direction: 'forward' }))
    expect(count('GET', API.transactions)).toBe(3)

    store.dispatch(api.internalActions.onOnline()) // what setupListeners dispatches on the browser's online event
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(count('GET', API.transactions) - 3).toBe(1)
  })

  it('a read that keeps timing out gives up within its overall deadline, not after every retry', async () => {
    mockServer({ timeoutRate: 1 }, () => 0)
    const store = makeStore({ http: { ...FAST, readDeadlineMs: 250 } })
    const result = await store.dispatch(api.endpoints.getBalance.initiate())
    expect(result.error).toBeDefined()
    // Per-attempt timeout 100ms within a 250ms deadline leaves room for at most three attempts.
    expect(count('GET', API.balance)).toBeLessThanOrEqual(3)
  })
})
