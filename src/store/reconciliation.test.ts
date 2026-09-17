/**
 * Reconciliation (ADR-0006), through the store against the real mock server.
 *
 * The rule under test: only the server's answer ends an unknown transfer. A found transfer resolves it; a rejection
 * bound to the key takes the change back; a miss, an error or a request refused unsent is not an answer.
 */
import { afterAll, afterEach, beforeAll, describe, it, expect } from 'vitest'
import { clearAllListeners } from '@reduxjs/toolkit'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { API, SendMoneyRequestSchema, type SendMoneyRequest } from '../api/contracts'
import { novabizApi as api, type TransactionsPageArgs } from '../api/novabizApi'
import { makeStore, type AppStore, type StoreOptions } from '.'
import { retryTransfer, sendTransfer } from './sendTransfer'
import { transferDraft } from './transferDraftSlice'
import { OPEN_TRANSFER_STORAGE_KEY, keyToKeep, persistOpenTransferKey, readOpenTransferKey } from './openTransferKey'
import { TIMEOUT_HOLD_MS, createChaosController, type ForcedTransferOutcome } from '../mocks/chaos'
import { DEFAULT_SETTLEMENT_DELAY_MS, createMockDb } from '../mocks/db'
import { createHandlers } from '../mocks/handlers'

const BASE = 'http://novabiz.test'
const KEY = '3f1c9a52-7b3e-4d2a-9c1e-5a6b7c8d9e0f'
const FIRST_PAGE: TransactionsPageArgs = { filters: {}, limit: 25, cursor: null }
const request = (amountKobo: number): SendMoneyRequest => SendMoneyRequestSchema.parse({
  recipient: { accountNumber: '0123456789', bankCode: '058', accountName: 'Ngozi Okafor' },
  amountKobo,
})

const server = setupServer()
/** Every request the mock received, in order: "POST /api/transfers", "GET /api/transfers", "GET /api/balance"… */
const seen: string[] = []
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  server.events.on('request:start', ({ request: r }) => { seen.push(`${r.method} ${new URL(r.url).pathname}`) })
})
/** Stores made by a test. Their reconciliation loops outlive the test unless stopped, and would add to the next count. */
const stores: AppStore[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.dispatch(clearAllListeners())
  server.resetHandlers()
  seen.length = 0
})
afterAll(() => server.close())

const lookups = () => seen.filter((s) => s === 'GET /api/transfers').length
const posts = () => seen.filter((s) => s === 'POST /api/transfers').length

async function setup({ force, store: storeOptions = {}, tracking = {} }: {
  force?: ForcedTransferOutcome
  store?: Partial<StoreOptions>
  tracking?: Partial<NonNullable<StoreOptions['tracking']>>
} = {}) {
  let current = new Date('2026-09-16T10:30:00.000Z').getTime()
  const gates = { post: Promise.resolve() }
  const chaos = createChaosController({
    settings: { latencyMs: 0, jitterMs: 0 },
    random: () => 0.99,
    sleep: (ms) => (ms === TIMEOUT_HOLD_MS ? new Promise<never>(() => {}) : Promise.resolve()),
  })
  if (force) chaos.forceNextTransfer(force)
  const db = createMockDb({ now: () => new Date(current), settlementOutcome: chaos.settlementOutcome })
  server.use(...createHandlers(db, { chaos, beforeProcessing: async (r) => { if (r.method === 'POST') await gates.post } }))
  const store = makeStore({
    http: { baseUrl: BASE, timeoutMs: 100, retryBaseDelayMs: 1, retryMaxDelayMs: 2, random: () => 0.5 },
    tracking: { initialIntervalMs: 10, maxIntervalMs: 20, giveUpAfterMs: 400, random: () => 0.5, ...tracking },
    ...storeOptions,
  })
  stores.push(store)
  await store.dispatch(api.endpoints.getBalance.initiate())
  await store.dispatch(api.endpoints.getTransactionsPage.initiate(FIRST_PAGE))
  const holdPosts = () => {
    let release = () => {}
    gates.post = new Promise<void>((resolve) => { release = resolve })
    return release
  }
  return { store, db, chaos, holdPosts, advance: (ms: number) => { current += ms } }
}

const available = (store: AppStore) => api.endpoints.getBalance.select()(store.getState()).data?.availableBalanceKobo ?? NaN
const rowFor = (store: AppStore) => api.endpoints.getTransactionsPage.select(FIRST_PAGE)(store.getState()).data?.items.find((t) => t.idempotencyKey === KEY)
const attempt = (store: AppStore) => store.getState().transferDraft.attempt
const serverTransfers = (db: ReturnType<typeof createMockDb>) => {
  const page = db.listTransactions({ limit: 1000 })
  return page.ok ? page.value.items.filter((t) => t.idempotencyKey === KEY) : []
}

describe('reconciliation — resolving an unknown transfer', () => {
  it('a transfer that went through: found pending, then followed until it settles', async () => {
    const { store, advance } = await setup({ force: 'timeout-after-commit' })
    const before = available(store)
    await store.dispatch(sendTransfer({ request: request(500_000), idempotencyKey: KEY }))
    expect(attempt(store)?.status).toBe('unknown')

    await expect.poll(() => attempt(store)?.status, { timeout: 2_000 }).toBe('pending')
    expect(attempt(store)?.reference).not.toBeNull()
    expect(rowFor(store)?.reference).toBe(attempt(store)?.reference)
    expect(available(store)).toBe(before - 500_000)

    advance(DEFAULT_SETTLEMENT_DELAY_MS)
    await expect.poll(() => attempt(store)?.status, { timeout: 2_000 }).toBe('successful')
    expect(rowFor(store)?.status).toBe('successful')
    await expect.poll(() => available(store), { timeout: 2_000 }).toBe(before - 500_000)
    expect(posts()).toBe(1)
  })

  it('a miss is not an answer: a slow POST that lands after the lookups missed it still resolves', async () => {
    const { store, db, holdPosts } = await setup()
    const release = holdPosts()
    await store.dispatch(sendTransfer({ request: request(500_000), idempotencyKey: KEY })) // times out: unknown
    expect(attempt(store)?.status).toBe('unknown')

    await expect.poll(() => lookups(), { timeout: 2_000 }).toBeGreaterThan(2) // every one a 404
    expect(attempt(store)?.status).toBe('unknown')
    expect(rowFor(store)?.status).toBe('pending') // still kept

    release() // the original POST is processed now
    await expect.poll(() => attempt(store)?.status, { timeout: 2_000 }).toBe('pending')
    expect(serverTransfers(db)).toHaveLength(1)
  })

  it('a rejection bound to the key takes the change back, with the balance from the server', async () => {
    const { store, holdPosts } = await setup()
    const before = available(store)
    const release = holdPosts()
    // More than the balance: once processed, the server refuses it and binds the refusal to the key.
    await store.dispatch(sendTransfer({ request: request(before + 100), idempotencyKey: KEY }))
    expect(attempt(store)?.status).toBe('unknown')
    expect(rowFor(store)).toBeDefined()

    release()
    await expect.poll(() => attempt(store)?.status, { timeout: 2_000 }).toBe('failed')
    expect(attempt(store)?.failure).toEqual({ message: 'Insufficient funds for this transfer. Nothing was sent.', afterAcceptance: false })
    expect(rowFor(store)).toBeUndefined()
    await expect.poll(() => available(store), { timeout: 2_000 }).toBe(before)
  })

  it('never takes the change back on misses: after about two minutes of checking it needs attention instead', async () => {
    const { store } = await setup({ force: 'timeout-before-commit' }) // nothing is ever written
    const before = available(store)
    await store.dispatch(sendTransfer({ request: request(500_000), idempotencyKey: KEY }))

    await expect.poll(() => attempt(store)?.needsAttention, { timeout: 3_000 }).toBe(true)
    expect(attempt(store)?.status).toBe('unknown')
    expect(available(store)).toBe(before - 500_000)
    expect(rowFor(store)?.status).toBe('pending')
    expect(lookups()).toBeGreaterThan(3)
  })

  it('a lookup refused unsent is not a rejection: the transfer stays unknown', async () => {
    // A data service that never becomes ready: every request is refused before it is sent.
    const { store } = await setup({ store: { serviceReady: new Promise<void>(() => {}), serviceWaitMs: 5 } })
    store.dispatch(transferDraft.attemptRestored({ idempotencyKey: KEY }))
    await expect.poll(() => attempt(store)?.needsAttention, { timeout: 3_000 }).toBe(true)
    expect(attempt(store)?.status).toBe('unknown')
  })
})

describe('reconciliation — pausing, reconnecting and asking again', () => {
  it('pauses while offline and checks at once on reconnect', async () => {
    const { store } = await setup({ force: 'timeout-before-commit', tracking: { initialIntervalMs: 50, maxIntervalMs: 50, giveUpAfterMs: 60_000 } })
    await store.dispatch(sendTransfer({ request: request(500_000), idempotencyKey: KEY }))
    await expect.poll(() => lookups(), { timeout: 2_000 }).toBeGreaterThan(0)

    store.dispatch(api.internalActions.onOffline())
    await new Promise((resolve) => setTimeout(resolve, 60)) // let a check already in flight finish
    const whileOffline = lookups()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(lookups()).toBe(whileOffline)

    store.dispatch(api.internalActions.onOnline())
    await expect.poll(() => lookups(), { timeout: 50, interval: 5 }).toBeGreaterThan(whileOffline)
  })

  it('pauses while the tab is hidden and checks at once when it is shown', async () => {
    const { store } = await setup({ force: 'timeout-before-commit', tracking: { initialIntervalMs: 50, maxIntervalMs: 50, giveUpAfterMs: 60_000 } })
    await store.dispatch(sendTransfer({ request: request(500_000), idempotencyKey: KEY }))
    await expect.poll(() => lookups(), { timeout: 2_000 }).toBeGreaterThan(0)

    store.dispatch(api.internalActions.onFocusLost())
    await new Promise((resolve) => setTimeout(resolve, 60))
    const whileHidden = lookups()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(lookups()).toBe(whileHidden)

    store.dispatch(api.internalActions.onFocus())
    await expect.poll(() => lookups(), { timeout: 50, interval: 5 }).toBeGreaterThan(whileHidden)
  })

  it('on reconnect, reconciles first and refetches the balance only once the outcome is known', async () => {
    // Long gaps, so the only check is the one the reconnect triggers.
    const { store } = await setup({ force: 'timeout-after-commit', tracking: { initialIntervalMs: 60_000, maxIntervalMs: 60_000, giveUpAfterMs: 600_000 } })
    await store.dispatch(sendTransfer({ request: request(500_000), idempotencyKey: KEY }))
    expect(attempt(store)?.status).toBe('unknown')
    seen.length = 0

    store.dispatch(api.internalActions.onOffline())
    store.dispatch(api.internalActions.onOnline())
    await expect.poll(() => attempt(store)?.status, { timeout: 2_000 }).toBe('pending')
    await expect.poll(() => seen.includes('GET /api/balance'), { timeout: 2_000 }).toBe(true)
    expect(seen.indexOf('GET /api/transfers')).toBeLessThan(seen.indexOf('GET /api/balance'))
  })

  it('"Check status" after it needs attention starts checking again', async () => {
    const { store } = await setup({ force: 'timeout-before-commit' })
    await store.dispatch(sendTransfer({ request: request(500_000), idempotencyKey: KEY }))
    await expect.poll(() => attempt(store)?.needsAttention, { timeout: 3_000 }).toBe(true)
    const before = lookups()

    store.dispatch(transferDraft.reconciliationRestarted({ idempotencyKey: KEY }))
    expect(attempt(store)?.needsAttention).toBe(false)
    await expect.poll(() => lookups(), { timeout: 2_000 }).toBeGreaterThan(before)
  })
})

describe('reconciliation — "Try again" with the same key', () => {
  it('creates the transfer exactly once when the first attempt never landed, without reducing the balance twice', async () => {
    const { store, db } = await setup({ force: 'timeout-before-commit' })
    const before = available(store)
    await store.dispatch(sendTransfer({ request: request(500_000), idempotencyKey: KEY }))
    await expect.poll(() => attempt(store)?.needsAttention, { timeout: 3_000 }).toBe(true)

    expect(await store.dispatch(retryTransfer())).toBe(true)
    expect(attempt(store)?.status).toBe('pending')
    expect(serverTransfers(db)).toHaveLength(1)
    expect(available(store)).toBe(before - 500_000)
    expect(api.endpoints.getTransactionsPage.select(FIRST_PAGE)(store.getState()).data?.items.filter((t) => t.idempotencyKey === KEY)).toHaveLength(1)
  })

  it('replays instead of paying twice when the first attempt did land', async () => {
    const { store, db } = await setup({ force: 'timeout-after-commit' })
    // Every lookup fails, so reconciliation cannot find the transfer that did go through.
    server.use(http.get(`*${API.transfers}`, () => HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Down', rejected: false } }, { status: 500 })))
    await store.dispatch(sendTransfer({ request: request(500_000), idempotencyKey: KEY }))
    await expect.poll(() => attempt(store)?.needsAttention, { timeout: 3_000 }).toBe(true)
    expect(serverTransfers(db)).toHaveLength(1)

    await store.dispatch(retryTransfer())
    expect(attempt(store)?.status).toBe('pending')
    expect(serverTransfers(db)).toHaveLength(1)
    expect(posts()).toBe(2)
  })

  it('does nothing for an attempt restored after a reload, which has no request to send', async () => {
    const { store } = await setup({ store: { serviceReady: new Promise<void>(() => {}), serviceWaitMs: 5 } })
    store.dispatch(transferDraft.attemptRestored({ idempotencyKey: KEY }))
    await expect.poll(() => attempt(store)?.needsAttention, { timeout: 3_000 }).toBe(true)
    expect(await store.dispatch(retryTransfer())).toBe(false)
    expect(posts()).toBe(0)
  })
})

describe('reconciliation — after a reload', () => {
  it('checks a restored key and resolves it from the server', async () => {
    const { store, db } = await setup()
    const created = db.createTransfer(request(500_000), KEY)
    expect(created.ok).toBe(true)
    store.dispatch(transferDraft.attemptRestored({ idempotencyKey: KEY }))
    expect(attempt(store)).toMatchObject({ status: 'unknown', request: null })
    expect(store.getState().transferDraft.step).toBe('result')
    await expect.poll(() => attempt(store)?.status, { timeout: 2_000 }).toBe('pending')
  })

  it('keeps only the key, only while the outcome is open, and survives storage that throws', () => {
    const data = new Map<string, string>()
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => { data.set(k, v) },
      removeItem: (k: string) => { data.delete(k) },
    } as unknown as Storage
    const store = makeStore()
    stores.push(store)
    persistOpenTransferKey(store, storage)

    store.dispatch(transferDraft.attemptStarted({ idempotencyKey: KEY, request: request(500_000) }))
    expect([...data.entries()]).toEqual([[OPEN_TRANSFER_STORAGE_KEY, KEY]])
    store.dispatch(transferDraft.attemptUnknown({ idempotencyKey: KEY }))
    expect(readOpenTransferKey(storage)).toBe(KEY)
    store.dispatch(transferDraft.attemptAccepted({ idempotencyKey: KEY, transfer: { reference: 'NVB1', status: 'pending', failureReason: null } }))
    expect(data.size).toBe(0)
    expect(keyToKeep(store.getState())).toBeNull()

    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } } as unknown as Storage
    const other = makeStore()
    stores.push(other)
    expect(() => persistOpenTransferKey(other, broken)).not.toThrow()
    expect(() => other.dispatch(transferDraft.attemptStarted({ idempotencyKey: KEY, request: request(500_000) }))).not.toThrow()
    expect(readOpenTransferKey(broken)).toBeNull()
  })
})

describe('reconciliation — review findings', () => {
  it('"Try again" after the cache was refetched still shows the transfer and the reduced balance', async () => {
    const { store } = await setup({ force: 'timeout-before-commit' })
    const before = available(store)
    await store.dispatch(sendTransfer({ request: request(500_000), idempotencyKey: KEY }))
    await expect.poll(() => attempt(store)?.needsAttention, { timeout: 3_000 }).toBe(true)

    // The held reconnect is released once it needs attention: the server's copy replaces the optimistic change.
    await store.dispatch(api.endpoints.getBalance.initiate(undefined, { forceRefetch: true }))
    await store.dispatch(api.endpoints.getTransactionsPage.initiate(FIRST_PAGE, { forceRefetch: true }))
    expect(available(store)).toBe(before)
    expect(rowFor(store)).toBeUndefined()

    await store.dispatch(retryTransfer())
    expect(attempt(store)?.status).toBe('pending')
    expect(rowFor(store)).toMatchObject({ status: 'pending', idempotencyKey: KEY })
    await expect.poll(() => available(store), { timeout: 2_000 }).toBe(before - 500_000)
  })
})
