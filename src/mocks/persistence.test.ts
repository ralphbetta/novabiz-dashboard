/**
 * The mock server's data survives a reload (ADR-0005).
 */
import { afterAll, afterEach, beforeAll, describe, it, expect, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { API, IDEMPOTENCY_HEADER, SendMoneyRequestSchema } from '../api/contracts'
import { TIMEOUT_HOLD_MS, createChaosController } from './chaos'
import { DEFAULT_SETTLEMENT_DELAY_MS, createMockDb, type MockDbSnapshot } from './db'
import { createHandlers } from './handlers'
import { MOCK_DB_STORAGE_KEY, createMockPersistence, loadMockDbSnapshot, saveMockDbSnapshot } from './persistence'
import { OPEN_TRANSFER_STORAGE_KEY } from '../store/openTransferKey'

const KEY = '3f1c9a52-7b3e-4d2a-9c1e-5a6b7c8d9e0f'
const request = (amountKobo: number, accountName = 'Ngozi Okafor') => SendMoneyRequestSchema.parse({
  recipient: { accountNumber: '0123456789', bankCode: '058', accountName },
  amountKobo,
})

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    data,
    storage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => { data.set(k, v) },
      removeItem: (k: string) => { data.delete(k) },
    } as unknown as Storage,
  }
}

/** Saves a database the way the browser does, then starts a new one from what was saved, as after a reload. */
function reload(db: ReturnType<typeof createMockDb>, now: () => Date) {
  const { storage } = memoryStorage()
  saveMockDbSnapshot(storage, db.snapshot())
  const snapshot = loadMockDbSnapshot(storage)
  if (!snapshot) throw new Error('snapshot did not load')
  return createMockDb({ now, snapshot })
}

describe('restoring the mock database', () => {
  it('keeps a transfer, the balance, and the transfer list exactly as they were', () => {
    let current = new Date('2026-09-16T10:30:00.000Z').getTime()
    const now = () => new Date(current)
    const db = createMockDb({ now })
    expect(db.createTransfer(request(500_000), KEY).ok).toBe(true)

    const restored = reload(db, now)
    expect(restored.getBalance()).toEqual(db.getBalance())
    expect(restored.listTransactions({ limit: 50 })).toEqual(db.listTransactions({ limit: 50 }))
    expect(restored.findTransferByKey(KEY)).toEqual(db.findTransferByKey(KEY))
    current += 1
    expect(restored.snapshot().transactions).toHaveLength(db.snapshot().transactions.length)
  })

  it('still knows every idempotency key: the same request replays, a different one conflicts', () => {
    const now = () => new Date('2026-09-16T10:30:00.000Z')
    const db = createMockDb({ now })
    const first = db.createTransfer(request(500_000), KEY)
    const restored = reload(db, now)

    const replay = restored.createTransfer(request(500_000), KEY)
    expect(replay.ok && replay.value.replayed).toBe(true)
    expect(replay.ok && first.ok && replay.value.transfer.id).toBe(first.ok && first.value.transfer.id)
    expect(restored.createTransfer(request(600_000), KEY)).toMatchObject({ ok: false, code: 'IDEMPOTENCY_KEY_REUSED' })
  })

  it('keeps a rejection bound to its key', () => {
    const now = () => new Date('2026-09-16T10:30:00.000Z')
    const db = createMockDb({ now })
    const refused = db.createTransfer(request(10_000_000_000), KEY)
    expect(refused).toMatchObject({ ok: false, code: 'INSUFFICIENT_FUNDS' })
    expect(reload(db, now).findTransferByKey(KEY)).toEqual(refused)
  })

  it('settles a pending transfer after the reload, on its original schedule', () => {
    let current = new Date('2026-09-16T10:30:00.000Z').getTime()
    const now = () => new Date(current)
    const db = createMockDb({ now })
    db.createTransfer(request(500_000), KEY)
    const restored = reload(db, now)

    const pending = restored.findTransferByKey(KEY)
    expect(pending.ok && pending.value.status).toBe('pending')
    current += DEFAULT_SETTLEMENT_DELAY_MS
    const settled = restored.findTransferByKey(KEY)
    expect(settled.ok && settled.value.status).toBe('successful')
  })

  it('keeps beneficiaries in their order', () => {
    const now = () => new Date('2026-09-16T10:30:00.000Z')
    const db = createMockDb({ now })
    db.createTransfer(SendMoneyRequestSchema.parse({ recipient: { accountNumber: '1122334455', bankCode: '057', accountName: 'Emeka Nwosu' }, amountKobo: 50_000 }), KEY)
    expect(reload(db, now).listBeneficiaries()).toEqual(db.listBeneficiaries())
  })

  it('fits comfortably in localStorage', () => {
    const size = JSON.stringify(createMockDb({ now: () => new Date('2026-09-16T10:30:00.000Z') }).snapshot()).length
    expect(size).toBeLessThan(1_500_000) // localStorage allows about 5 MB per origin
  })
})

describe('loading saved data', () => {
  const valid = () => createMockDb({ now: () => new Date('2026-09-16T10:30:00.000Z') }).snapshot()
  const loadWith = (value: string | null) => {
    const { storage, data } = memoryStorage()
    if (value !== null) data.set(MOCK_DB_STORAGE_KEY, value)
    return loadMockDbSnapshot(storage)
  }

  it('loads a valid snapshot', () => {
    expect(loadWith(JSON.stringify(valid()))).not.toBeNull()
  })

  it.each<[string, (s: MockDbSnapshot) => unknown]>([
    ['from an older version', (s) => ({ ...s, version: 0 })],
    ['seeded differently', (s) => ({ ...s, seed: s.seed + 1 })],
    ['with a tampered row', (s) => ({ ...s, transactions: [{ ...s.transactions[0], amountKobo: 1.5 }, ...s.transactions.slice(1)] })],
    ['with a malformed idempotency record', (s) => ({ ...s, idempotency: [['k', { fingerprint: null, outcome: { kind: 'nope' } }]] })],
  ])('ignores a snapshot %s', (_label, change) => {
    expect(loadWith(JSON.stringify(change(valid())))).toBeNull()
  })

  it('ignores nothing saved and text that is not JSON', () => {
    expect(loadWith(null)).toBeNull()
    expect(loadWith('{not json')).toBeNull()
  })

  it('survives storage that throws, on reading and on writing', () => {
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('quota') }, removeItem: () => { throw new Error('blocked') } } as unknown as Storage
    expect(loadMockDbSnapshot(broken)).toBeNull()
    expect(() => saveMockDbSnapshot(broken, valid())).not.toThrow()
  })
})

describe('saving after requests', () => {
  const BASE = 'http://novabiz.test'
  const server = setupServer()
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterEach(() => { server.resetHandlers(); vi.useRealTimers() })
  afterAll(() => server.close())

  it('saves a transfer the moment it is committed, even when its reply is held back', async () => {
    const db = createMockDb({ now: () => new Date('2026-09-16T10:30:00.000Z') })
    const chaos = createChaosController({
      settings: { latencyMs: 0, jitterMs: 0 },
      random: () => 0.99,
      sleep: (ms) => (ms === TIMEOUT_HOLD_MS ? new Promise<never>(() => {}) : Promise.resolve()),
    })
    chaos.forceNextTransfer('timeout-after-commit')
    const { storage } = memoryStorage()
    const persistence = createMockPersistence({ local: storage, snapshot: () => db.snapshot() })
    server.use(...createHandlers(db, { chaos, afterProcessing: persistence.afterProcessing }))

    const controller = new AbortController()
    void fetch(`${BASE}${API.transfers}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [IDEMPOTENCY_HEADER]: KEY },
      body: JSON.stringify(request(500_000)),
      signal: controller.signal,
    }).catch(() => {})

    await expect.poll(() => loadMockDbSnapshot(storage)?.transactions.some((t) => (t as { idempotencyKey: string | null }).idempotencyKey === KEY)).toBe(true)
    controller.abort()
  })

  it('saves reads at most once per delay, and writes at once', () => {
    vi.useFakeTimers()
    let version = 0
    const { storage } = memoryStorage()
    const setItem = vi.spyOn(storage, 'setItem')
    // A snapshot that changes every time, so no save is skipped as unchanged.
    const db = createMockDb({ now: () => new Date('2026-09-16T10:30:00.000Z') })
    const persistence = createMockPersistence({ local: storage, snapshot: () => ({ ...db.snapshot(), nextSequence: ++version }), delayMs: 250 })
    const get = new Request(`${BASE}${API.balance}`)
    persistence.afterProcessing(get)
    persistence.afterProcessing(get)
    persistence.afterProcessing(get)
    expect(setItem).not.toHaveBeenCalled()
    vi.advanceTimersByTime(250)
    expect(setItem).toHaveBeenCalledOnce()

    persistence.afterProcessing(get)
    persistence.afterProcessing(new Request(`${BASE}${API.transfers}`, { method: 'POST' }))
    expect(setItem).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(250)
    expect(setItem).toHaveBeenCalledTimes(2) // the write's save covered the pending read
  })
})

describe('persistence — review findings', () => {
  const BASE_URL = 'http://novabiz.test'
  afterEach(() => { vi.useRealTimers() })

  it('reset wins over a save already scheduled, and over saves from requests that finish afterwards', () => {
    vi.useFakeTimers()
    const { storage, data } = memoryStorage()
    const db = createMockDb({ now: () => new Date('2026-09-16T10:30:00.000Z') })
    const persistence = createMockPersistence({ local: storage, snapshot: () => db.snapshot() })
    persistence.save()
    expect(data.has(MOCK_DB_STORAGE_KEY)).toBe(true)

    db.createTransfer(request(500_000), KEY) // changed, so the scheduled save would write
    persistence.afterProcessing(new Request(`${BASE_URL}${API.balance}`)) // a read schedules a save
    persistence.reset()
    expect(data.has(MOCK_DB_STORAGE_KEY)).toBe(false)

    vi.advanceTimersByTime(1_000)
    persistence.afterProcessing(new Request(`${BASE_URL}${API.transfers}`, { method: 'POST' })) // a write finishing late
    persistence.save() // pagehide
    expect(data.has(MOCK_DB_STORAGE_KEY)).toBe(false)
  })

  it('reset also forgets the unconfirmed transfer the app would otherwise check against the fresh data', () => {
    const local = memoryStorage()
    const session = memoryStorage()
    session.data.set(OPEN_TRANSFER_STORAGE_KEY, KEY)
    const db = createMockDb({ now: () => new Date('2026-09-16T10:30:00.000Z') })
    createMockPersistence({ local: local.storage, session: session.storage, snapshot: () => db.snapshot() }).reset()
    expect(session.data.has(OPEN_TRANSFER_STORAGE_KEY)).toBe(false)
  })

  it('a tab that only read does not overwrite a transfer another tab saved', () => {
    vi.useFakeTimers()
    const { storage, data } = memoryStorage()
    const now = () => new Date('2026-09-16T10:30:00.000Z')
    const tabA = createMockDb({ now })
    const tabB = createMockDb({ now })
    const persistA = createMockPersistence({ local: storage, snapshot: () => tabA.snapshot() })
    const persistB = createMockPersistence({ local: storage, snapshot: () => tabB.snapshot() })
    persistB.save()

    tabA.createTransfer(request(500_000), KEY)
    persistA.afterProcessing(new Request(`${BASE_URL}${API.transfers}`, { method: 'POST' }))
    expect(data.get(MOCK_DB_STORAGE_KEY)).toContain(KEY)

    persistB.afterProcessing(new Request(`${BASE_URL}${API.balance}`)) // tab B reads; its own data is unchanged
    vi.advanceTimersByTime(1_000)
    expect(data.get(MOCK_DB_STORAGE_KEY)).toContain(KEY)
  })
})
