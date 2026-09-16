import { afterAll, afterEach, beforeAll, describe, it, expect } from 'vitest'
import { setupServer } from 'msw/node'
import {
  API, ApiErrorSchema, BalanceSchema, IDEMPOTENCY_HEADER, TransactionsPageSchema, TransferResponseSchema,
  type SendMoneyRequestWire,
} from '../api/contracts'
import {
  DEFAULT_CHAOS_SETTINGS, ROLLS_PER_REQUEST, SIMULATED_SETTLEMENT_FAILURE_REASON, TIMEOUT_HOLD_MS, createChaosController,
  type ChaosSettings, type ForcedTransferOutcome,
} from './chaos'
import { DEFAULT_SETTLEMENT_DELAY_MS, createMockDb } from './db'
import { REPLAYED_HEADER, createHandlers } from './handlers'

const BASE = 'http://novabiz.test'
const KEY = '3f1c9a52-7b3e-4d2a-9c1e-5a6b7c8d9e0f'
const KEY_2 = '9b2d4e61-1c3a-4f5b-8d7e-2a1b3c4d5e6f'
/** How long a test waits before concluding a request will never be answered. */
const NO_ANSWER_MS = 150
const transfer: SendMoneyRequestWire = {
  recipient: { accountNumber: '0123456789', bankCode: '058', accountName: 'Ngozi Okafor' },
  amountKobo: 100_050,
}

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

/**
 * Mock API with chaos. Sleeps are recorded, never actually waited. `random` defaults to always 0.99.
 * A timeout's hold never ends unless `releaseHolds` is set: it stands in for a hold that outlasts the
 * client's own timeout.
 */
function useChaosApi(
  settings: Partial<ChaosSettings> = {},
  random: () => number = () => 0.99,
  { releaseHolds = false } = {},
) {
  let current = new Date('2026-09-16T10:30:00.000Z').getTime()
  const slept: number[] = []
  const chaos = createChaosController({
    settings: { latencyMs: 0, jitterMs: 0, ...settings },
    random,
    sleep: async (ms) => {
      slept.push(ms)
      if (ms === TIMEOUT_HOLD_MS && !releaseHolds) await new Promise<never>(() => {})
    },
  })
  const db = createMockDb({ now: () => new Date(current), settlementOutcome: chaos.settlementOutcome })
  server.use(...createHandlers(db, { chaos }))
  return { chaos, slept, advance: (ms: number) => { current += ms } }
}

const post = (key = KEY, body: SendMoneyRequestWire = transfer, signal?: AbortSignal) =>
  fetch(`${BASE}${API.transfers}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [IDEMPOTENCY_HEADER]: key },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  })
/** Returns `random` rolls from `rolls` in order, then 0.99 forever. */
const sequence = (rolls: number[]) => {
  let i = 0
  return () => rolls[i++] ?? 0.99
}
const lookupStatus = async (key = KEY) => (await fetch(`${BASE}${API.transfers}?idempotencyKey=${key}`)).status
const balance = async () => BalanceSchema.parse(await (await fetch(`${BASE}${API.balance}`)).json())

/** Resolves 'no-answer' if the request is not answered within NO_ANSWER_MS, as a client timeout would. */
async function withClientTimeout(start: (signal: AbortSignal) => Promise<Response>): Promise<Response | 'no-answer'> {
  try {
    return await start(AbortSignal.timeout(NO_ANSWER_MS))
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'no-answer'
    throw error
  }
}

describe('settings', () => {
  it('ships with latency on and every failure off, so the default demo is realistic but reliable', () => {
    expect(DEFAULT_CHAOS_SETTINGS).toMatchObject({ errorRate: 0, timeoutRate: 0, settlementFailureRate: 0 })
    expect(DEFAULT_CHAOS_SETTINGS.latencyMs).toBeGreaterThan(0)
  })

  it('merges partial updates', () => {
    const chaos = createChaosController()
    expect(chaos.update({ errorRate: 0.25 })).toMatchObject({ ...DEFAULT_CHAOS_SETTINGS, errorRate: 0.25 })
  })

  it.each([
    ['a rate above 1', { errorRate: 1.5 }],
    ['a negative rate', { timeoutRate: -0.1 }],
    ['negative latency', { latencyMs: -1 }],
    ['fractional latency', { latencyMs: 10.5 }],
  ])('rejects %s instead of silently clamping', (_label, bad) => {
    expect(() => createChaosController().update(bad)).toThrow()
  })

  it('rejects an unknown forced outcome', () => {
    expect(() => createChaosController().forceNextTransfer('explode' as ForcedTransferOutcome)).toThrow()
  })

  it('reset restores defaults and clears anything forced', () => {
    const chaos = createChaosController()
    chaos.update({ errorRate: 1 })
    chaos.forceNextTransfer('timeout-after-commit')
    chaos.forceNextSettlement('failed')
    chaos.reset()
    expect(chaos.getSettings()).toEqual(DEFAULT_CHAOS_SETTINGS)
    expect(chaos.getForced()).toEqual({ transfer: null, settlement: null })
  })
})

describe('latency', () => {
  it('delays every request by latency plus random jitter, from 0 up to jitterMs inclusive', async () => {
    // Each request draws ROLLS_PER_REQUEST rolls, jitter first: jitter at 0, 0.5 and 0.9999 of 0..300.
    const request = (jitterRoll: number) => [jitterRoll, ...Array<number>(ROLLS_PER_REQUEST - 1).fill(0.99)]
    const { slept } = useChaosApi(
      { latencyMs: 400, jitterMs: 300 },
      sequence([...request(0), ...request(0.5), ...request(0.9999)]),
    )
    await fetch(`${BASE}${API.balance}`)
    await fetch(`${BASE}${API.transactions}`)
    await fetch(`${BASE}${API.balance}`)
    expect(slept).toEqual([400, 550, 700])
  })

  it('does not sleep at all when latency and jitter are zero', async () => {
    const { slept } = useChaosApi({ latencyMs: 0, jitterMs: 0 })
    await fetch(`${BASE}${API.balance}`)
    expect(slept).toEqual([])
  })
})

describe('random failure rates', () => {
  it.each([
    ['GET balance', () => fetch(`${BASE}${API.balance}`)],
    ['GET transactions', () => fetch(`${BASE}${API.transactions}`)],
    ['GET transfer by key', () => fetch(`${BASE}${API.transfers}?idempotencyKey=${KEY}`)],
    ['POST transfer', () => post()],
  ])('errorRate 1: %s answers a contract-valid 500 that does not claim rejection', async (_label, request) => {
    useChaosApi({ errorRate: 1 }, () => 0)
    const response = await request()
    expect(response.status).toBe(500)
    expect(ApiErrorSchema.parse(await response.json()).error).toMatchObject({ code: 'INTERNAL_ERROR', rejected: false })
  })

  it('errorRate 0 and timeoutRate 0: requests succeed', async () => {
    useChaosApi({ errorRate: 0, timeoutRate: 0 }, () => 0)
    expect((await fetch(`${BASE}${API.balance}`)).status).toBe(200)
  })

  it('timeoutRate 1: a read is never answered', async () => {
    useChaosApi({ timeoutRate: 1 }, () => 0)
    expect(await withClientTimeout((signal) => fetch(`${BASE}${API.balance}`, { signal }))).toBe('no-answer')
  })

  it('timeoutRate 1: a transfer POST can time out after the transfer is written', async () => {
    const { chaos } = useChaosApi({ timeoutRate: 1, afterCommitRate: 1 }, () => 0)
    expect(await withClientTimeout((signal) => post(KEY, transfer, signal))).toBe('no-answer')
    chaos.update({ timeoutRate: 0 }) // or the lookup itself would time out
    expect(await lookupStatus()).toBe(200)
  })

  it('a timeout wins over an error when both rates hit', async () => {
    useChaosApi({ timeoutRate: 1, errorRate: 1 }, () => 0)
    expect(await withClientTimeout((signal) => fetch(`${BASE}${API.balance}`, { signal }))).toBe('no-answer')
  })

  it('afterCommitRate 0: injected write failures never move money', async () => {
    const { chaos } = useChaosApi({ errorRate: 1, afterCommitRate: 0 }, () => 0.5)
    const response = await post()
    expect(response.status).toBe(500)
    chaos.update({ errorRate: 0 }) // or the lookup itself would be failed by the same rate
    expect(await lookupStatus()).toBe(404)
  })

  it('afterCommitRate 1: injected write failures always happen after the transfer is written', async () => {
    // Rolls in order: jitter, timeout (miss), error (hit via errorRate 1 below), commit point.
    const { chaos } = useChaosApi({ errorRate: 1, afterCommitRate: 1 }, sequence([0, 0.99, 0.99, 0]))
    expect((await post()).status).toBe(500)
    chaos.update({ errorRate: 0 }) // or the lookup itself would be failed by the same rate
    expect(await lookupStatus()).toBe(200)
  })
})

describe('forced transfer outcomes — the deterministic demo', () => {
  it('timeout-after-commit: the client never hears back, but the transfer exists and funds are held  ⭐', async () => {
    // The scenario ADR-0006 exists for, and the E2E test marked as the most important in ADR-0011.
    const { chaos } = useChaosApi()
    const before = await balance()
    chaos.forceNextTransfer('timeout-after-commit')

    expect(await withClientTimeout((signal) => post(KEY, transfer, signal))).toBe('no-answer')

    expect(await lookupStatus()).toBe(200)
    expect((await balance()).availableBalanceKobo).toBe(before.availableBalanceKobo - transfer.amountKobo)
  })

  it('timeout-before-commit: the client never hears back, and nothing was written', async () => {
    const { chaos } = useChaosApi()
    const before = await balance()
    chaos.forceNextTransfer('timeout-before-commit')
    expect(await withClientTimeout((signal) => post(KEY, transfer, signal))).toBe('no-answer')
    expect(await lookupStatus()).toBe(404)
    expect((await balance()).availableBalanceKobo).toBe(before.availableBalanceKobo)
  })

  it('error-after-commit: a 500 that does not claim rejection, while the transfer exists', async () => {
    const { chaos } = useChaosApi()
    chaos.forceNextTransfer('error-after-commit')
    const response = await post()
    expect(response.status).toBe(500)
    expect(ApiErrorSchema.parse(await response.json()).error.rejected).toBe(false)
    expect(await lookupStatus()).toBe(200)
  })

  it('error-before-commit: a 500, and nothing was written', async () => {
    const { chaos } = useChaosApi()
    chaos.forceNextTransfer('error-before-commit')
    expect((await post()).status).toBe(500)
    expect(await lookupStatus()).toBe(404)
  })

  it('success overrides the random rates for that one transfer', async () => {
    const { chaos } = useChaosApi({ errorRate: 1 }, () => 0)
    chaos.forceNextTransfer('success')
    expect((await post()).status).toBe(202)
    expect((await post(KEY_2)).status).toBe(500) // back to the rate
  })

  it('is consumed once, by the next transfer POST only — not by reads polled in between', async () => {
    const { chaos } = useChaosApi()
    chaos.forceNextTransfer('error-before-commit')
    expect((await fetch(`${BASE}${API.balance}`)).status).toBe(200)
    expect((await fetch(`${BASE}${API.transactions}`)).status).toBe(200)
    expect(await lookupStatus()).toBe(404) // the status poll reconciliation uses: answered, not failed
    expect(chaos.getForced().transfer).toBe('error-before-commit')

    expect((await post()).status).toBe(500)
    expect(chaos.getForced().transfer).toBeNull()
    expect((await post()).status).toBe(202) // the retry, same key, now goes through
  })

  it.each<ForcedTransferOutcome>(['error-after-commit', 'timeout-after-commit'])(
    '%s stays armed through a replay and a db rejection, until a transfer is actually created',
    async (outcome) => {
      const { chaos } = useChaosApi()
      expect((await post(KEY)).status).toBe(202)
      chaos.forceNextTransfer(outcome)

      const replay = await post(KEY)
      expect(replay.status).toBe(202)
      expect(replay.headers.get(REPLAYED_HEADER)).toBe('true')
      const reused = await post(KEY, { ...transfer, amountKobo: transfer.amountKobo + 1 })
      expect(reused.status).toBe(409) // the db's real answer, not a simulated failure
      expect(chaos.getForced().transfer).toBe(outcome)

      const created = await withClientTimeout((signal) => post(KEY_2, transfer, signal))
      if (outcome === 'error-after-commit') expect(created).toMatchObject({ status: 500 })
      else expect(created).toBe('no-answer')
      expect(chaos.getForced().transfer).toBeNull()
      expect(await lookupStatus(KEY_2)).toBe(200)
    },
  )

  it('a timeout is held, not hung forever: after TIMEOUT_HOLD_MS the response is released', async () => {
    const { chaos, slept } = useChaosApi({}, undefined, { releaseHolds: true })
    chaos.forceNextTransfer('timeout-after-commit')
    expect((await post(KEY)).status).toBe(202) // the committed transfer's own response, released late
    chaos.forceNextTransfer('timeout-before-commit')
    expect((await post(KEY_2)).status).toBe(500) // nothing was written, so it cannot claim success
    expect(await lookupStatus(KEY_2)).toBe(404)
    expect(slept).toEqual([TIMEOUT_HOLD_MS, TIMEOUT_HOLD_MS])
  })

  it('forcing an outcome does not shift the random sequence for later requests', async () => {
    let draws = 0
    const { chaos } = useChaosApi({}, () => { draws++; return 0.99 })
    await post(KEY)
    const unforced = draws
    chaos.forceNextTransfer('success')
    chaos.forceNextSettlement('failed')
    await post(KEY_2)
    expect(draws - unforced).toBe(unforced)
  })

  it('a retry after timeout-after-commit replays the committed transfer — no double debit', async () => {
    const { chaos } = useChaosApi()
    const before = await balance()
    chaos.forceNextTransfer('timeout-after-commit')
    expect(await withClientTimeout((signal) => post(KEY, transfer, signal))).toBe('no-answer')

    const retry = await post()
    expect(retry.status).toBe(202)
    expect(TransferResponseSchema.parse(await retry.json()).transfer.idempotencyKey).toBe(KEY)
    expect((await balance()).availableBalanceKobo).toBe(before.availableBalanceKobo - transfer.amountKobo)
    const page = TransactionsPageSchema.parse(await (await fetch(`${BASE}${API.transactions}?limit=100`)).json())
    expect(page.items.filter((t) => t.idempotencyKey === KEY)).toHaveLength(1)
  })
})

describe('settlement outcomes', () => {
  const settleAndLookup = async (advance: (ms: number) => void, key = KEY) => {
    advance(DEFAULT_SETTLEMENT_DELAY_MS)
    return TransferResponseSchema.parse(await (await fetch(`${BASE}${API.transfers}?idempotencyKey=${key}`)).json()).transfer
  }

  it('forceNextSettlement failed: the next transfer created fails to settle, and releases its funds', async () => {
    const { chaos, advance } = useChaosApi()
    const before = await balance()
    chaos.forceNextSettlement('failed')
    await post()
    expect(await settleAndLookup(advance)).toMatchObject({ status: 'failed', failureReason: SIMULATED_SETTLEMENT_FAILURE_REASON })
    expect((await balance()).availableBalanceKobo).toBe(before.availableBalanceKobo)
  })

  it('binds the forced settlement to the transfer created next, not whichever settles first', async () => {
    const { chaos, advance } = useChaosApi()
    await post(KEY) // created before forcing: must settle normally
    chaos.forceNextSettlement('failed')
    await post(KEY_2)
    advance(DEFAULT_SETTLEMENT_DELAY_MS)
    expect(await settleAndLookup(() => {}, KEY)).toMatchObject({ status: 'successful' })
    expect(await settleAndLookup(() => {}, KEY_2)).toMatchObject({ status: 'failed' })
  })

  it('a replay does not consume the forced settlement', async () => {
    const { chaos, advance } = useChaosApi()
    await post(KEY)
    chaos.forceNextSettlement('failed')
    await post(KEY) // replay
    expect(chaos.getForced().settlement).toBe('failed')
    expect(await settleAndLookup(advance, KEY)).toMatchObject({ status: 'successful' })
  })

  it('settlementFailureRate 1: every new transfer fails to settle', async () => {
    const { advance } = useChaosApi({ settlementFailureRate: 1 }, () => 0)
    await post()
    expect(await settleAndLookup(advance)).toMatchObject({ status: 'failed' })
  })
})

describe('adversarial review of the chaos controls', () => {
  it('finding 1: every request draws the same number of random rolls, whatever happens to it', async () => {
    let draws = 0
    const { chaos } = useChaosApi({}, () => { draws++; return 0.99 })
    const countDraws = async (request: () => Promise<unknown>) => {
      const before = draws
      await request()
      return draws - before
    }
    const KEY_3 = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
    const KEY_4 = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e'
    const KEY_5 = '3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f'

    const counts: Record<string, number> = {}
    counts.read = await countDraws(() => fetch(`${BASE}${API.balance}`))
    counts.createsTransfer = await countDraws(() => post(KEY))
    counts.replay = await countDraws(() => post(KEY))
    counts.rejectedByDb = await countDraws(() => post(KEY_2, { ...transfer, amountKobo: 9_000_000_000_000 }))
    chaos.forceNextTransfer('error-before-commit')
    counts.forcedBeforeCommit = await countDraws(() => post(KEY_3))
    chaos.update({ errorRate: 1, afterCommitRate: 0 })
    counts.randomBeforeCommit = await countDraws(() => post(KEY_4))
    chaos.update({ errorRate: 0 })
    chaos.forceNextTransfer('error-after-commit')
    counts.forcedAfterCommit = await countDraws(() => post(KEY_5))

    for (const [kind, count] of Object.entries(counts)) expect(count, kind).toBe(ROLLS_PER_REQUEST)
  })

  it('finding 2: update() rejects an unknown setting instead of silently ignoring it', () => {
    const chaos = createChaosController()
    // As typed by hand in the browser console, where there are no types to catch the typo.
    expect(() => chaos.update({ latency: 5000 } as unknown as Partial<ChaosSettings>)).toThrow(/latency/)
    expect(chaos.getSettings()).toEqual(DEFAULT_CHAOS_SETTINGS)
  })

  it('finding 2: the constructor rejects an unknown setting too', () => {
    expect(() => createChaosController({ settings: { errorrate: 1 } as unknown as Partial<ChaosSettings> })).toThrow(/errorrate/)
  })

  it('finding 3: a random after-commit failure does not replace a db rejection, since nothing was written', async () => {
    useChaosApi({ errorRate: 1, afterCommitRate: 1 }) // random 0.99: error hits, and after commit
    const response = await post(KEY, { ...transfer, amountKobo: 9_000_000_000_000 })
    expect(response.status).toBe(422)
    expect(ApiErrorSchema.parse(await response.json()).error).toMatchObject({ code: 'INSUFFICIENT_FUNDS', rejected: true })
  })

  it('finding 3: a random after-commit failure does not hit a replay, which writes nothing', async () => {
    const { chaos } = useChaosApi()
    expect((await post(KEY)).status).toBe(202)
    chaos.update({ errorRate: 1, afterCommitRate: 1 })
    const replay = await post(KEY)
    expect(replay.status).toBe(202)
    expect(replay.headers.get(REPLAYED_HEADER)).toBe('true')
  })

  it('finding 4: an armed after-commit outcome does not switch off the random rates for other POSTs', async () => {
    const { chaos } = useChaosApi()
    chaos.forceNextTransfer('timeout-after-commit')
    chaos.update({ errorRate: 1, afterCommitRate: 0 })
    // The random rate still applies before commit, so this POST never reaches the db...
    const first = await withClientTimeout((signal) => post(KEY, transfer, signal))
    expect(first === 'no-answer' ? 'no-answer' : first.status).toBe(500)
    // ...and so it did not create a transfer, and the forced outcome is still armed.
    expect(chaos.getForced().transfer).toBe('timeout-after-commit')

    chaos.update({ errorRate: 0 })
    expect(await withClientTimeout((signal) => post(KEY_2, transfer, signal))).toBe('no-answer')
    expect(await lookupStatus(KEY_2)).toBe(200)
  })

  it('finding 5: latency beyond the client timeout reproduces the in-flight race from ADR-0006', async () => {
    // The request is slower than the client is patient: the client gives up, a lookup misses, and only
    // then does the transfer commit. This is why a lookup miss must never be read as "nothing written".
    let releaseFirst!: () => void
    const firstSleep = new Promise<void>((resolve) => { releaseFirst = resolve })
    let sleeps = 0
    const chaos = createChaosController({
      settings: { latencyMs: 20_000, jitterMs: 0 },
      random: () => 0.99,
      sleep: (ms) => (sleeps++ === 0 && ms === 20_000 ? firstSleep : Promise.resolve()),
    })
    const db = createMockDb({ now: () => new Date('2026-09-16T10:30:00.000Z'), settlementOutcome: chaos.settlementOutcome })
    server.use(...createHandlers(db, { chaos }))

    expect(await withClientTimeout((signal) => post(KEY, transfer, signal))).toBe('no-answer')
    expect(await lookupStatus()).toBe(404) // the client's check: "not seen yet"

    releaseFirst()
    let status = 404
    for (let i = 0; i < 50 && status === 404; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      status = await lookupStatus()
    }
    expect(status).toBe(200) // it committed after the client gave up and after the miss
  })

  it('finding 6: reset() restores the settings the controller was created with, not the global defaults', () => {
    const chaos = createChaosController({ settings: { latencyMs: 0, jitterMs: 0, errorRate: 0.3 } })
    chaos.update({ errorRate: 1, timeoutRate: 1 })
    chaos.forceNextTransfer('timeout-after-commit')
    chaos.reset()
    expect(chaos.getSettings()).toEqual({ ...DEFAULT_CHAOS_SETTINGS, latencyMs: 0, jitterMs: 0, errorRate: 0.3 })
    expect(chaos.getForced().transfer).toBeNull()
  })
})
