import { describe, it, expect } from 'vitest'
import { TransactionSchema, type TransactionWire } from '../api/contracts'
import { DAY_MS, startOfDay } from '../lib/time'
import {
  DIACRITIC_NAME,
  HOSTILE_COUNTERPARTY_NAME,
  HOSTILE_DESCRIPTIONS,
  OPENING_BALANCE_KOBO,
  SEED_HISTORY_DAYS,
  SEED_NEWEST_PENDING_COUNT,
  SEED_TODAY_COUNT,
  SEED_TRANSACTION_COUNT,
  generateSeedTransactions,
} from './seed'
import { createRng } from './prng'

const NOW = new Date('2026-09-16T10:30:00.000Z') // 11:30 WAT
const rows = generateSeedTransactions({ now: NOW })
const FIRST_PAGE = 50

describe('determinism', () => {
  it('produces identical data for the same seed and now', () => {
    expect(generateSeedTransactions({ now: NOW })).toEqual(rows)
  })

  // What screenshots and the demo rely on. Only pending status of rows under a day old, and the
  // amount of a deliberate overdraw attempt, may vary with `now` (see seed.ts header).
  it.each([
    ['09:00 vs 21:00 WAT on the same day', '2026-09-16T08:00:00.000Z', '2026-09-16T20:00:00.000Z'],
    ['a different day entirely', '2026-09-16T08:00:00.000Z', '2026-03-02T14:17:00.000Z'],
    ['exactly midnight WAT', '2026-09-16T08:00:00.000Z', '2026-09-15T23:00:00.000Z'],
  ])('keeps every row\'s identity and content stable across %s', (_label, isoA, isoB) => {
    const a = generateSeedTransactions({ now: new Date(isoA) })
    const b = generateSeedTransactions({ now: new Date(isoB) })
    const stable = (r: TransactionWire) =>
      [r.id, r.type, r.channel, r.description, r.counterparty, r.idempotencyKey]
    expect(a.map(stable)).toEqual(b.map(stable))

    const overdraw = (r: TransactionWire) => r.failureReason === 'Insufficient funds'
    a.forEach((row, i) => {
      const other = b[i]
      if (!other || overdraw(row) || overdraw(other)) return
      expect(row.amountKobo).toBe(other.amountKobo)
    })
  })

  it('produces different data for a different seed', () => {
    expect(generateSeedTransactions({ now: NOW, seed: 1 })).not.toEqual(rows)
  })

  it('PRNG yields the same sequence for the same seed', () => {
    const a = createRng(42), b = createRng(42)
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(Array.from({ length: 5 }, () => b.next()))
  })
})

describe('shape', () => {
  it(`generates exactly ${SEED_TRANSACTION_COUNT} transactions — the brief's 1,000+ rows`, () => {
    expect(rows).toHaveLength(SEED_TRANSACTION_COUNT)
  })

  it('every row satisfies the shared API contract', () => {
    const failures = rows
      .map((row, i) => ({ i, result: TransactionSchema.safeParse(row) }))
      .filter(({ result }) => !result.success)
      .map(({ i, result }) => `row ${i}: ${result.error?.issues[0]?.message}`)
    expect(failures).toEqual([])
  })

  it('has unique ids and references', () => {
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length)
    expect(new Set(rows.map((r) => r.reference)).size).toBe(rows.length)
  })

  // Timestamps can tie, so the order that cursor pagination relies on is (createdAt, id), never
  // createdAt alone. Checked at exactly midnight WAT, where all of today's rows share one instant.
  it.each([
    ['mid-morning', '2026-09-16T10:30:00.000Z'],
    ['exactly midnight WAT', '2026-09-15T23:00:00.000Z'],
  ])('is strictly ordered newest first by (createdAt, id) when opened %s', (_label, iso) => {
    const generated = generateSeedTransactions({ now: new Date(iso) })
    for (let i = 1; i < generated.length; i++) {
      const prev = generated[i - 1]
      const curr = generated[i]
      if (!prev || !curr) throw new Error('unreachable')
      const newer = prev.createdAt > curr.createdAt || (prev.createdAt === curr.createdAt && prev.id > curr.id)
      expect(newer, `rows ${i - 1} and ${i} are out of order or tied`).toBe(true)
    }
  })

  it('does produce tied timestamps at midnight, so the tiebreaker is genuinely needed', () => {
    const atMidnight = generateSeedTransactions({ now: new Date('2026-09-15T23:00:00.000Z') })
    expect(new Set(atMidnight.map((r) => r.createdAt)).size).toBeLessThan(atMidnight.length)
  })

  it('carries idempotency keys on merchant-initiated debits only', () => {
    expect(rows.every((r) => (r.type === 'debit') === (r.idempotencyKey !== null))).toBe(true)
  })

  it('has a realistic mix of types, statuses and channels', () => {
    const count = (pred: (r: TransactionWire) => boolean) => rows.filter(pred).length
    expect(count((r) => r.type === 'credit')).toBeGreaterThan(count((r) => r.type === 'debit'))
    for (const status of ['pending', 'successful', 'failed'] as const) {
      expect(count((r) => r.status === status)).toBeGreaterThan(0)
    }
    for (const channel of ['qr', 'pos', 'transfer', 'ussd'] as const) {
      expect(count((r) => r.channel === channel)).toBeGreaterThan(0)
    }
    // Amounts with kobo, not just whole naira, so formatting is exercised on real data.
    expect(count((r) => r.amountKobo % 100 !== 0)).toBeGreaterThan(0)
  })
})

describe('time placement', () => {
  it(`keeps every timestamp within the last ${SEED_HISTORY_DAYS} days and never in the future`, () => {
    const earliest = NOW.getTime() - SEED_HISTORY_DAYS * DAY_MS
    for (const r of rows) {
      const t = Date.parse(r.createdAt)
      expect(t).toBeLessThanOrEqual(NOW.getTime())
      expect(t).toBeGreaterThanOrEqual(earliest)
    }
  })

  it('always has pending rows at the top of the feed, where the demo shows them', () => {
    const newest = rows.slice(0, SEED_NEWEST_PENDING_COUNT)
    // A pending debit that would overdraw is failed instead, so allow for that, but require some.
    expect(newest.filter((r) => r.status === 'pending').length).toBeGreaterThan(0)
  })

  it('only leaves transactions pending if they are under a day old', () => {
    for (const r of rows.filter((r) => r.status === 'pending')) {
      expect(NOW.getTime() - Date.parse(r.createdAt)).toBeLessThan(DAY_MS)
    }
  })

  // "Today's totals" must have data whenever the app is opened, including at the day's edges.
  it.each([
    ['mid-morning', '2026-09-16T10:30:00.000Z'],
    ['five minutes after midnight WAT', '2026-09-15T23:05:00.000Z'],
    ['five minutes before midnight WAT', '2026-09-16T22:55:00.000Z'],
    ['exactly midnight WAT', '2026-09-15T23:00:00.000Z'],
  ])(`places at least ${SEED_TODAY_COUNT} transactions in the current business day when opened %s`, (_label, iso) => {
    const now = new Date(iso)
    const dayStart = startOfDay(now).getTime()
    const today = generateSeedTransactions({ now }).filter((r) => {
      const t = Date.parse(r.createdAt)
      return t >= dayStart && t <= now.getTime()
    })
    expect(today.length).toBeGreaterThanOrEqual(SEED_TODAY_COUNT)
  })
})

describe('ledger consistency', () => {
  it('opens with the opening balance as the oldest transaction', () => {
    expect(rows.at(-1)).toMatchObject({ type: 'credit', status: 'successful', amountKobo: OPENING_BALANCE_KOBO })
  })

  it('never lets available balance go negative — overdrawing debits are failed instead', () => {
    let available = 0
    for (const r of [...rows].reverse()) {
      if (r.status === 'failed') continue
      if (r.type === 'credit') {
        if (r.status === 'successful') available += r.amountKobo
      } else {
        available -= r.amountKobo
        expect(available).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('includes debits failed for insufficient funds — a real case the UI must show — but not a flood', () => {
    // Guards both directions. An earlier draft had 130 of ~340 debits failing this way because debit
    // amounts dwarfed credits; the first correction then had zero. Neither is a realistic merchant.
    const debits = rows.filter((r) => r.type === 'debit')
    const insufficient = debits.filter((r) => r.failureReason === 'Insufficient funds')
    expect(insufficient.length).toBeGreaterThan(0)
    expect(insufficient.length / debits.length).toBeLessThan(0.05)
  })

  it('only fails a debit for insufficient funds when it genuinely exceeded the available balance', () => {
    let available = 0
    for (const r of [...rows].reverse()) {
      if (r.failureReason === 'Insufficient funds') expect(r.amountKobo).toBeGreaterThan(available)
      if (r.status === 'failed') continue
      if (r.type === 'credit') {
        if (r.status === 'successful') available += r.amountKobo
      } else {
        available -= r.amountKobo
      }
    }
  })
})

describe('fixtures for ADR-0013', () => {
  const firstPage = rows.slice(0, FIRST_PAGE)

  it.each(Object.entries(HOSTILE_DESCRIPTIONS))('places the %s description on the first page', (_key, description) => {
    expect(firstPage.some((r) => r.description === description)).toBe(true)
  })

  it('places a hostile counterparty name on the first page, with a consistent description', () => {
    const row = firstPage.find((r) => r.counterparty.name === HOSTILE_COUNTERPARTY_NAME)
    expect(row).toBeDefined()
  })

  it('places a legitimate diacritic name on the first page', () => {
    expect(firstPage.some((r) => r.counterparty.name === DIACRITIC_NAME)).toBe(true)
  })

  it('fixtures hold the actual hostile code points at runtime (source uses escapes)', () => {
    const codePoints = (s: string) => [...s].map((c) => c.codePointAt(0))
    expect(codePoints(HOSTILE_DESCRIPTIONS.bidiOverride)).toContain(0x202e)
    expect(codePoints(HOSTILE_DESCRIPTIONS.zeroWidth)).toEqual(expect.arrayContaining([0x200b, 0x200d, 0xfeff]))
    expect(HOSTILE_DESCRIPTIONS.oversized).toHaveLength(5000)
  })
})
