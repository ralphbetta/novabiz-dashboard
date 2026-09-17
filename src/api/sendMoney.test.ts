/**
 * The optimistic send, end to end through the store against the real mock server (ADR-0006, ADR-0007).
 *
 * The cases that matter are the failures: only a definite failure may undo the optimistic change. A timeout on a
 * transfer the server committed must leave the balance reduced and the row in place.
 */
import { afterAll, afterEach, beforeAll, describe, it, expect } from 'vitest'
import { clearAllListeners } from '@reduxjs/toolkit'
import { setupServer } from 'msw/node'
import { IDEMPOTENCY_HEADER, SendMoneyRequestSchema, type SendMoneyRequest } from './contracts'
import { novabizApi as api, type TransactionsPageArgs } from './novabizApi'
import { OPTIMISTIC_REFERENCE } from './optimisticTransfer'
import { makeStore, type AppStore } from '../store'
import { sendTransfer } from '../store/sendTransfer'
import { connectivity } from '../store/connectivitySlice'
import { TIMEOUT_HOLD_MS, createChaosController, type ForcedTransferOutcome } from '../mocks/chaos'
import { DEFAULT_SETTLEMENT_DELAY_MS, createMockDb } from '../mocks/db'
import { createHandlers } from '../mocks/handlers'

const BASE = 'http://novabiz.test'
const KEY = '3f1c9a52-7b3e-4d2a-9c1e-5a6b7c8d9e0f'
const FAST = { baseUrl: BASE, timeoutMs: 200, retryBaseDelayMs: 1, retryMaxDelayMs: 2 }
const FIRST_PAGE: TransactionsPageArgs = { filters: {}, limit: 25, cursor: null }
const FAILED_ONLY: TransactionsPageArgs = { filters: { status: 'failed' }, limit: 25, cursor: null }

const request = (amountKobo: number): SendMoneyRequest => SendMoneyRequestSchema.parse({
  recipient: { accountNumber: '0123456789', bankCode: '058', accountName: 'Ngozi Okafor' },
  amountKobo,
})

const server = setupServer()
const keysSent: (string | null)[] = []
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  server.events.on('request:start', ({ request: r }) => { if (r.method === 'POST') keysSent.push(r.headers.get(IDEMPOTENCY_HEADER)) })
})
/** Stores made by a test: their transfer trackers outlive the test unless stopped. */
const stores: AppStore[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.dispatch(clearAllListeners())
  server.resetHandlers()
  keysSent.length = 0
})
afterAll(() => server.close())

async function setup({ force }: { force?: ForcedTransferOutcome } = {}) {
  /** Requests wait on this before the mock answers. `holdPosts()` swaps it to hold the transfer POST. */
  const gates = { post: Promise.resolve() }
  let current = new Date('2026-09-16T10:30:00.000Z').getTime()
  const chaos = createChaosController({
    settings: { latencyMs: 0, jitterMs: 0 },
    random: () => 0.99,
    sleep: (ms) => (ms === TIMEOUT_HOLD_MS ? new Promise<never>(() => {}) : Promise.resolve()),
  })
  if (force) chaos.forceNextTransfer(force)
  const db = createMockDb({ now: () => new Date(current), settlementOutcome: chaos.settlementOutcome })
  server.use(...createHandlers(db, { chaos, beforeProcessing: async (r) => { if (r.method === 'POST') await gates.post } }))
  const store = makeStore({ http: FAST, tracking: { initialIntervalMs: 5, maxIntervalMs: 5, giveUpAfterMs: 2_000 } })
  stores.push(store)
  // Screens that are open: the balance, the first page of the table, and a filtered page the transfer does not match.
  await store.dispatch(api.endpoints.getBalance.initiate())
  await store.dispatch(api.endpoints.getTransactionsPage.initiate(FIRST_PAGE))
  await store.dispatch(api.endpoints.getTransactionsPage.initiate(FAILED_ONLY))
  const holdPosts = () => {
    let release = () => {}
    gates.post = new Promise<void>((resolve) => { release = resolve })
    return release
  }
  return { store, chaos, db, holdPosts, advance: (ms: number) => { current += ms } }
}

const available = (store: AppStore) => api.endpoints.getBalance.select()(store.getState()).data?.availableBalanceKobo ?? NaN
const page = (store: AppStore, args = FIRST_PAGE) => api.endpoints.getTransactionsPage.select(args)(store.getState()).data
const rowFor = (store: AppStore, args = FIRST_PAGE) => page(store, args)?.items.find((t) => t.idempotencyKey === KEY)
const attempt = (store: AppStore) => store.getState().transferDraft.attempt

describe('sendMoney — optimistic update', () => {
  it('reduces the balance and adds a pending row before the server answers, only where the row belongs', async () => {
    const { store } = await setup()
    const before = available(store)
    const totalBefore = page(store)?.totalCount ?? NaN

    const sending = store.dispatch(sendTransfer({ request: request(500_000), idempotencyKey: KEY }))
    expect(attempt(store)?.status).toBe('sending')
    expect(available(store)).toBe(before - 500_000)
    expect(rowFor(store)).toMatchObject({ status: 'pending', reference: OPTIMISTIC_REFERENCE, amountKobo: 500_000 })
    expect(page(store)?.items[0]?.idempotencyKey).toBe(KEY)
    expect(page(store)?.totalCount).toBe(totalBefore + 1)
    expect(rowFor(store, FAILED_ONLY)).toBeUndefined()

    await sending
    expect(keysSent).toEqual([KEY])
  })

  it('on acceptance keeps the change and swaps in the server row, then follows it until it settles', async () => {
    const { store, advance } = await setup()
    const before = available(store)
    await store.dispatch(sendTransfer({ request: request(500_000), idempotencyKey: KEY }))

    expect(attempt(store)).toMatchObject({ status: 'pending', failure: null })
    expect(attempt(store)?.reference).not.toBeNull()
    expect(rowFor(store)?.reference).toBe(attempt(store)?.reference)
    expect(available(store)).toBe(before - 500_000)

    advance(DEFAULT_SETTLEMENT_DELAY_MS)
    await expect.poll(() => attempt(store)?.status, { timeout: 2_000 }).toBe('successful')
    expect(rowFor(store)?.status).toBe('successful')
    await expect.poll(() => available(store), { timeout: 2_000 }).toBe(before - 500_000)
  })

  it('on a definite rejection undoes both changes and records why', async () => {
    const { store } = await setup()
    const before = available(store)
    const rowsBefore = page(store)?.items.length

    // More than the available balance: the server refuses with INSUFFICIENT_FUNDS, rejected: true.
    await store.dispatch(sendTransfer({ request: request(before + 100), idempotencyKey: KEY }))

    expect(attempt(store)?.status).toBe('failed')
    expect(attempt(store)?.failure).toEqual({ message: 'Insufficient funds for this transfer. Nothing was sent.', afterAcceptance: false })
    expect(available(store)).toBe(before)
    expect(rowFor(store)).toBeUndefined()
    expect(page(store)?.items.length).toBe(rowsBefore)
  })

  it.each<ForcedTransferOutcome>(['timeout-after-commit', 'error-after-commit', 'timeout-before-commit', 'error-before-commit'])(
    '%s: keeps the balance reduced and the row, and marks the attempt unknown',
    async (force) => {
      const { store } = await setup({ force })
      const before = available(store)
      await store.dispatch(sendTransfer({ request: request(500_000), idempotencyKey: KEY }))

      expect(attempt(store)?.status).toBe('unknown')
      expect(available(store)).toBe(before - 500_000)
      expect(rowFor(store)?.status).toBe('pending')
      // Never retried: one POST, whatever went wrong.
      expect(keysSent).toEqual([KEY])
    },
  )
})

describe('sendMoney — review findings', () => {
  const PENDING_ONLY: TransactionsPageArgs = { filters: { status: 'pending' }, limit: 25, cursor: null }

  it('removes a settled row from a page whose filters it no longer matches', async () => {
    const { store, advance } = await setup()
    await store.dispatch(api.endpoints.getTransactionsPage.initiate(PENDING_ONLY))
    const pendingTotal = page(store, PENDING_ONLY)?.totalCount ?? NaN

    await store.dispatch(sendTransfer({ request: request(500_000), idempotencyKey: KEY }))
    expect(rowFor(store, PENDING_ONLY)?.status).toBe('pending')
    expect(page(store, PENDING_ONLY)?.totalCount).toBe(pendingTotal + 1)

    advance(DEFAULT_SETTLEMENT_DELAY_MS)
    await expect.poll(() => rowFor(store)?.status, { timeout: 2_000 }).toBe('successful')
    expect(rowFor(store, PENDING_ONLY)).toBeUndefined()
    expect(page(store, PENDING_ONLY)?.totalCount).toBe(pendingTotal)
    expect(page(store, PENDING_ONLY)?.items.every((t) => t.status === 'pending')).toBe(true)
  })

  it('a rejection after the balance and page refetched mid-flight leaves the fresh server data intact', async () => {
    const { store, db, holdPosts } = await setup()
    const before = available(store)

    const release = holdPosts()
    // More than the balance, so the server will refuse it (INSUFFICIENT_FUNDS, rejected: true).
    const sending = store.dispatch(sendTransfer({ request: request(before + 100), idempotencyKey: KEY }))

    // While it is in flight, another transfer lands and both screens refetch.
    const other = db.createTransfer(request(300_000), '00000000-0000-4000-8000-000000000077')
    expect(other.ok).toBe(true)
    await store.dispatch(api.endpoints.getBalance.initiate(undefined, { forceRefetch: true }))
    await store.dispatch(api.endpoints.getTransactionsPage.initiate(FIRST_PAGE, { forceRefetch: true }))
    const server = { available: available(store), items: page(store)?.items.map((t) => t.id) }
    expect(server.available).toBe(before - 300_000)

    release()
    await sending
    expect(available(store)).toBe(server.available)
    expect(page(store)?.items.map((t) => t.id)).toEqual(server.items)
  })

  it('sends nothing for a second transfer while the first one\'s outcome is open', async () => {
    const { store, holdPosts } = await setup()
    const release = holdPosts()
    const first = store.dispatch(sendTransfer({ request: request(500_000), idempotencyKey: KEY }))
    const second = store.dispatch(sendTransfer({ request: request(500_000) }))
    expect(await second).toBeNull()
    release()
    expect(await first).toBe(KEY)
    expect(keysSent).toEqual([KEY])
    expect(attempt(store)?.idempotencyKey).toBe(KEY)
  })

  it('sends nothing and changes nothing while the browser reports no connection (ADR-0014)', async () => {
    const { store } = await setup()
    const before = available(store)
    store.dispatch(connectivity.connectionChanged({ online: false }))
    expect(await store.dispatch(sendTransfer({ request: request(500_000), idempotencyKey: KEY }))).toBeNull()
    expect(keysSent).toEqual([])
    expect(attempt(store)).toBeNull()
    expect(available(store)).toBe(before)
    expect(rowFor(store)).toBeUndefined()
  })

  it('the endpoint alone patches the cache but never touches the Send Money draft', async () => {
    const { store } = await setup()
    await store.dispatch(api.endpoints.sendMoney.initiate({ request: request(500_000), idempotencyKey: KEY }))
    expect(attempt(store)).toBeNull()
    expect(store.getState().transferDraft.step).toBe('recipient')
    expect(rowFor(store)?.status).toBe('pending')
  })

  it('marks the attempt when tracking gives up on a transfer that is still pending', async () => {
    const { store } = await setup()
    // Never advanced, so the transfer stays pending; the tracker gives up after its window (2s in setup, shortened here).
    await store.dispatch(sendTransfer({ request: request(500_000), idempotencyKey: KEY }))
    expect(attempt(store)).toMatchObject({ status: 'pending', trackingStopped: false })
    await expect.poll(() => attempt(store)?.trackingStopped, { timeout: 4_000 }).toBe(true)
    expect(attempt(store)?.status).toBe('pending')
  })
})
