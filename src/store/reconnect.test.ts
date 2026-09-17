/**
 * Reconnecting must not refetch over a transfer whose outcome is open (ADR-0006, review finding 3).
 *
 * A reconnect refetch replaces the cached balance and pages with the server's copy. While a transfer is in flight or
 * its outcome is unknown, that would silently drop the kept optimistic change: the receipt would say "may already have
 * been sent" while the balance and table say nothing moved. The refetch waits until the outcome is known, or the
 * merchant starts over.
 */
import { afterAll, afterEach, beforeAll, describe, it, expect } from 'vitest'
import { clearAllListeners } from '@reduxjs/toolkit'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { SendMoneyRequestSchema } from '../api/contracts'
import { novabizApi as api } from '../api/novabizApi'
import { makeStore } from '.'
import { transferDraft } from './transferDraftSlice'
import { connectivity } from './connectivitySlice'
import { sendTransfer } from './sendTransfer'
import { TIMEOUT_HOLD_MS, createChaosController } from '../mocks/chaos'
import { createMockDb } from '../mocks/db'
import { createHandlers } from '../mocks/handlers'

const BASE = 'http://novabiz.test'
const KEY = '3f1c9a52-7b3e-4d2a-9c1e-5a6b7c8d9e0f'
const request = SendMoneyRequestSchema.parse({
  recipient: { accountNumber: '0123456789', bankCode: '058', accountName: 'Ngozi Okafor' },
  amountKobo: 500_000,
})

const server = setupServer()
const balanceRequests: string[] = []
const pageRequests: string[] = []
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  server.events.on('request:start', ({ request: r }) => { const path = new URL(r.url).pathname
    if (path === '/api/balance') balanceRequests.push(r.method)
    if (path === '/api/transactions' && !new URL(r.url).searchParams.has('idempotencyKey')) pageRequests.push(r.method)
  })
})
/** Stores made by a test: their transfer trackers outlive the test unless stopped. */
const stores: ReturnType<typeof makeStore>[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.dispatch(clearAllListeners())
  server.resetHandlers()
  balanceRequests.length = 0
  pageRequests.length = 0
})
afterAll(() => server.close())

async function storeWithUnknownTransfer() {
  const chaos = createChaosController({
    settings: { latencyMs: 0, jitterMs: 0 },
    random: () => 0.99,
    sleep: (ms) => (ms === TIMEOUT_HOLD_MS ? new Promise<never>(() => {}) : Promise.resolve()),
  })
  // Nothing is written, so reconciliation never finds it and the outcome stays unknown.
  chaos.forceNextTransfer('error-before-commit')
  server.use(...createHandlers(createMockDb({ now: () => new Date('2026-09-16T10:30:00.000Z') }), { chaos }))
  const store = makeStore({ http: { baseUrl: BASE, retryBaseDelayMs: 1, retryMaxDelayMs: 2 } })
  stores.push(store)
  // The balance is on screen: a live subscription, which is what refetchOnReconnect refetches.
  store.dispatch(api.endpoints.getBalance.initiate())
  await expect.poll(() => api.endpoints.getBalance.select()(store.getState()).data).toBeDefined()
  return store
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

describe('reconnect while a transfer outcome is open', () => {
  it('does not refetch over an unknown transfer, and refetches once the merchant starts over', async () => {
    const store = await storeWithUnknownTransfer()
    await store.dispatch(sendTransfer({ request, idempotencyKey: KEY }))
    expect(store.getState().transferDraft.attempt?.status).toBe('unknown')
    const kept = api.endpoints.getBalance.select()(store.getState()).data?.availableBalanceKobo
    balanceRequests.length = 0

    store.dispatch(api.internalActions.onOffline())
    store.dispatch(api.internalActions.onOnline())
    await settle()
    expect(balanceRequests).toEqual([])
    expect(api.endpoints.getBalance.select()(store.getState()).data?.availableBalanceKobo).toBe(kept)

    store.dispatch(transferDraft.draftReset())
    await expect.poll(() => balanceRequests).toEqual(['GET'])
  })

  it('refetches on reconnect as usual when no transfer outcome is open', async () => {
    const store = await storeWithUnknownTransfer()
    balanceRequests.length = 0
    store.dispatch(api.internalActions.onOffline())
    store.dispatch(api.internalActions.onOnline())
    await expect.poll(() => balanceRequests).toEqual(['GET'])
  })

  it('still refetches a read that failed offline with nothing cached, while the outcome is open (review finding)', async () => {
    const store = await storeWithUnknownTransfer()
    await store.dispatch(sendTransfer({ request, idempotencyKey: KEY }))
    expect(store.getState().transferDraft.attempt?.status).toBe('unknown')

    // Offline, the merchant opens the transactions page: it fails, with nothing cached to show.
    store.dispatch(api.internalActions.onOffline())
    store.dispatch(connectivity.connectionChanged({ online: false }))
    const failing = http.get(`${BASE}/api/transactions`, ({ request: r }) =>
      new URL(r.url).searchParams.has('idempotencyKey') ? undefined : HttpResponse.error(), { once: true })
    server.use(failing)
    const args = { filters: {}, limit: 25, cursor: null }
    store.dispatch(api.endpoints.getTransactionsPage.initiate(args))
    await expect.poll(() => api.endpoints.getTransactionsPage.select(args)(store.getState()).isError).toBe(true)
    expect(api.endpoints.getTransactionsPage.select(args)(store.getState()).data).toBeUndefined()
    // And a balance refresh fails too, but the balance keeps its data — the kept change.
    const kept = api.endpoints.getBalance.select()(store.getState()).data?.availableBalanceKobo
    server.use(http.get(`${BASE}/api/balance`, () => HttpResponse.error(), { once: true }))
    await store.dispatch(api.endpoints.getBalance.initiate(undefined, { subscribe: false, forceRefetch: true }))
    expect(api.endpoints.getBalance.select()(store.getState())).toMatchObject({ isError: true, data: { availableBalanceKobo: kept } })

    // Back online (the failing handler was used once). The outcome is still unknown, so the reconnect is held — but this read has nothing to protect.
    pageRequests.length = 0
    balanceRequests.length = 0
    store.dispatch(connectivity.connectionChanged({ online: true }))
    store.dispatch(api.internalActions.onOnline())
    await expect.poll(() => api.endpoints.getTransactionsPage.select(args)(store.getState()).data).toBeDefined()
    expect(store.getState().transferDraft.attempt?.status).toBe('unknown')
    await settle()
    expect(balanceRequests).toEqual([]) // the balance holds the kept change, so it still waits
    expect(api.endpoints.getBalance.select()(store.getState()).data?.availableBalanceKobo).toBe(kept)
  })

  it('drops a held reconnect if the connection goes again, and refetches only on the next real reconnect', async () => {
    const store = await storeWithUnknownTransfer()
    await store.dispatch(sendTransfer({ request, idempotencyKey: KEY }))
    balanceRequests.length = 0

    store.dispatch(api.internalActions.onOffline())
    store.dispatch(api.internalActions.onOnline()) // held: the outcome is unknown
    store.dispatch(api.internalActions.onOffline()) // offline again before the outcome is known
    store.dispatch(transferDraft.draftReset()) // outcome no longer open, but there is no connection
    await settle()
    expect(balanceRequests).toEqual([])

    store.dispatch(api.internalActions.onOnline())
    await expect.poll(() => balanceRequests).toEqual(['GET'])
  })
})
