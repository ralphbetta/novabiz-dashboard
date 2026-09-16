/**
 * Seed data for the mock API (ADR-0005).
 *
 * Determinism, stated precisely — seed.test.ts checks each part:
 *   - Same seed and same `now` produce identical output.
 *   - Across different `now` values, every row keeps the same id, reference number, type,
 *     channel, counterparty, description and idempotency key, because each row draws from its own
 *     random stream, seeded by its position, with every value drawn up front.
 *   - The newest SEED_NEWEST_PENDING_COUNT rows are always `pending`.
 *   - Two things legitimately vary with `now`: whether an older row under 24 hours old is `pending`, and
 *     the amount of a deliberate overdraw attempt, which is defined relative to the balance at that
 *     moment. Timestamps are placed relative to `now`, so "today's totals" always has data.
 *
 * The ledger is simulated in time order, so the data is internally consistent: a debit that would
 * overdraw the available balance is recorded as failed with "Insufficient funds".
 *
 * Ordering: rows are newest first by (createdAt, id). Timestamps can tie — at exactly midnight WAT
 * all of today's rows share one — so createdAt alone is not a total order. Ids embed a zero-padded
 * chronological sequence number, which breaks every tie. Cursor pagination must key on the pair.
 */
import type { TransactionStatus, TransactionWire } from '../api/contracts'
import { DAY_MS, calendarDate, startOfDay } from '../lib/time'
import { createRng, type Rng } from './prng'

export const SEED = 20260824 // the brief's issue date
export const SEED_TRANSACTION_COUNT = 1200
export const SEED_HISTORY_DAYS = 90
/** Transactions guaranteed to fall inside the current business day. */
export const SEED_TODAY_COUNT = 15
export const OPENING_BALANCE_KOBO = 25_000_000 // NGN 250,000.00
/**
 * The newest rows are always pending, so the pending state — which the UI must render — exists by
 * construction rather than depending on a roll among the few rows under a day old.
 */
export const SEED_NEWEST_PENDING_COUNT = 3
/** Width of the zero-padded sequence number in ids. Ids sort chronologically up to this many rows. */
export const ID_SEQUENCE_DIGITS = 5

/**
 * Illustrative bank list with CBN institution codes, for realistic counterparty data only.
 * Verify against a current NIBSS list before any real use.
 */
export const BANKS = [
  { code: '011', name: 'First Bank of Nigeria' },
  { code: '044', name: 'Access Bank' },
  { code: '058', name: 'Guaranty Trust Bank' },
  { code: '033', name: 'United Bank for Africa' },
  { code: '057', name: 'Zenith Bank' },
  { code: '070', name: 'Fidelity Bank' },
  { code: '232', name: 'Sterling Bank' },
  { code: '035', name: 'Wema Bank' },
] as const

/**
 * Deliberately hostile descriptions (ADR-0013). They sit on the first page so they are visible in
 * the running app, where each must render as inert, readable text.
 *
 * Every invisible or direction-changing character is written as a \u escape, never as the raw
 * character. A raw right-to-left override in source is the Trojan Source pattern: it makes code
 * display differently from how it executes. src/source-hygiene.test.ts fails the build on any raw
 * format character anywhere in src, docs or config.
 */
export const HOSTILE_DESCRIPTIONS = {
  scriptTag: '<script>alert("xss")</script>',
  imgOnError: '<img src=x onerror="alert(1)">',
  /** Right-to-left override: renders reversed, disguising the amount. */
  bidiOverride: 'Transfer to Musa \u202E00.000,05₦\u202C',
  zeroWidth: 'Ade\u200Bbayo\u200D Stores\uFEFF',
  oversized: ('Bulk settlement note: ' + 'invoice batch 2291 reconciled; '.repeat(170)).slice(0, 5000),
  empty: '',
  emojiOnly: '\u{1F6D2}\u{1F525}\u{1F4B8}',
} as const

/** A hostile counterparty name: HTML in a field set by another bank's customer. */
export const HOSTILE_COUNTERPARTY_NAME = '<b>Official Refund Desk</b>'

/**
 * A legitimate name with Yoruba diacritics, which sanitisation must preserve (ADR-0013).
 * Deliberately written with visible, printable characters: these are ordinary letters and
 * combining accents, not format characters.
 */
export const DIACRITIC_NAME = 'Adébáyọ̀ Ògúnlẹ́sì'

/** Newest-first positions on the first page that receive the fixtures above. */
const FIXTURE_POSITIONS = {
  scriptTag: 3,
  imgOnError: 7,
  bidiOverride: 11,
  zeroWidth: 16,
  oversized: 22,
  empty: 30,
  emojiOnly: 38,
  hostileCounterparty: 42,
  diacriticName: 5,
} as const

const FIRST_NAMES = [
  'Chinedu', 'Ngozi', 'Emeka', 'Adaeze', 'Tunde', 'Folake', 'Bola', 'Yetunde', 'Aminu', 'Zainab',
  'Musa', 'Hauwa', 'Ifeanyi', 'Kemi', 'Segun', 'Chiamaka', 'Ibrahim', 'Fatima', 'Oluwaseun', 'Uche',
  'Efe', 'Tamara', 'Blessing', 'Godwin',
] as const
const LAST_NAMES = [
  'Okafor', 'Adeyemi', 'Bello', 'Eze', 'Abubakar', 'Okonkwo', 'Balogun', 'Olawale', 'Nwosu',
  'Danjuma', 'Etim', 'Okoro', 'Ogunleye', 'Yusuf', 'Obi',
] as const
const SUPPLIERS = [
  'Kano Grains Depot', 'Oyingbo Foodstuff Traders', 'Alaba Electronics Wholesale', 'Aba Textile Hub',
  'Onitsha Market Supplies', 'Ikeja Packaging Co.',
] as const
const SUPPLY_ITEMS = [
  'rice supply', 'restock: soft drinks', 'packaging materials', 'generator diesel',
  'shop rent (part payment)', 'staff wages',
] as const
const CREDIT_CHANNELS = ['qr', 'qr', 'pos', 'pos', 'transfer', 'ussd'] as const
const CREDIT_FAILURES = ['Card declined by issuer', 'Payment timed out'] as const
const DEBIT_FAILURES = ['Beneficiary bank unavailable', 'Transaction declined'] as const

export interface SeedOptions {
  now: Date
  seed?: number
  count?: number
}

/** An independent stream per row, so one row's branching cannot shift another row's values. */
function rowRng(seed: number, sequence: number): Rng {
  return createRng((Math.imul(seed ^ 0x85ebca6b, 0x9e3779b1) + Math.imul(sequence + 1, 0xc2b2ae35)) >>> 0)
}

/** Credit amount in kobo. Always consumes exactly three draws. Whole-naira values are common. */
function creditAmount(rng: Rng): number {
  const band = rng.next()
  const raw =
    band < 0.6 ? rng.int(20_000, 500_000) // NGN 200 - 5,000
    : band < 0.92 ? rng.int(500_000, 5_000_000) // NGN 5,000 - 50,000
    : rng.int(5_000_000, 25_000_000) // NGN 50,000 - 250,000
  const wholeNaira = rng.chance(0.7)
  return wholeNaira ? Math.max(100, raw - (raw % 100)) : raw
}

/** Debit amount in kobo. Always consumes exactly two draws. */
function debitAmount(rng: Rng): number {
  const raw = rng.int(200_000, 6_000_000) // NGN 2,000 - 60,000
  const wholeNaira = rng.chance(0.85)
  return wholeNaira ? Math.max(100, raw - (raw % 100)) : raw
}

function placeTimestamps(rng: Rng, now: number, count: number): number[] {
  const dayStart = startOfDay(new Date(now)).getTime()
  const historyStart = now - SEED_HISTORY_DAYS * DAY_MS
  const times: number[] = []
  // Today's guaranteed rows. At exactly midnight the window is a single instant, so they all tie —
  // which is why ordering and cursors use (createdAt, id), never createdAt alone.
  for (let i = 0; i < SEED_TODAY_COUNT; i++) times.push(rng.int(dayStart, now))
  // The rest across history, strictly before today began. One slot is kept for the opening balance.
  for (let i = SEED_TODAY_COUNT; i < count - 1; i++) times.push(rng.int(historyStart + 1, dayStart - 1))
  return times.sort((a, b) => a - b)
}

const sequenceId = (sequence: number, rng: Rng) =>
  `txn_${String(sequence).padStart(ID_SEQUENCE_DIGITS, '0')}${rng.hex(8)}`

const reference = (sequence: number, at: number) =>
  `NVB${calendarDate(new Date(at)).replaceAll('-', '')}${String(sequence).padStart(6, '0')}`

export function generateSeedTransactions({ now, seed = SEED, count = SEED_TRANSACTION_COUNT }: SeedOptions): TransactionWire[] {
  if (count < SEED_TODAY_COUNT + 1) throw new Error(`count must be at least ${SEED_TODAY_COUNT + 1}`)
  if (count > 10 ** ID_SEQUENCE_DIGITS) throw new Error(`count must not exceed ${10 ** ID_SEQUENCE_DIGITS}`)
  const nowMs = now.getTime()
  const historyStart = nowMs - SEED_HISTORY_DAYS * DAY_MS

  const openingRng = rowRng(seed, 0)
  const rows: TransactionWire[] = [
    {
      id: sequenceId(0, openingRng),
      reference: reference(0, historyStart),
      type: 'credit',
      status: 'successful',
      channel: 'transfer',
      amountKobo: OPENING_BALANCE_KOBO,
      description: 'Opening balance: transfer from NovaSave',
      counterparty: { name: 'NovaSave Safe Lock', bankName: 'First Bank of Nigeria', accountNumberLast4: openingRng.digits(4) },
      createdAt: new Date(historyStart).toISOString(),
      idempotencyKey: null,
      failureReason: null,
    },
  ]

  let available = OPENING_BALANCE_KOBO

  placeTimestamps(createRng(seed), nowMs, count).forEach((at, index) => {
    const sequence = index + 1
    const r = rowRng(seed, sequence)

    // Every random value is drawn here, in a fixed order, before any branch depends on `now`.
    const id = sequenceId(sequence, r)
    const isCredit = r.chance(0.72)
    const pendingRoll = r.next()
    const failedRoll = r.next()
    const overdrawRoll = r.next()
    const bankName = r.pick(BANKS).name
    const accountNumberLast4 = r.digits(4)
    const person = `${r.pick(FIRST_NAMES)} ${r.pick(LAST_NAMES)}`
    const supplier = r.pick(SUPPLIERS)
    const toSupplier = r.chance(0.6)
    const item = r.pick(SUPPLY_ITEMS)
    const channel = r.pick(CREDIT_CHANNELS)
    const cardLast4 = r.digits(4)
    const creditKobo = creditAmount(r)
    const debitKobo = debitAmount(r)
    const overdrawExtraKobo = r.int(100_000, 5_000_000)
    const creditFailure = r.pick(CREDIT_FAILURES)
    const debitFailure = r.pick(DEBIT_FAILURES)
    const idempotencyKey = r.uuid()

    const isRecent = nowMs - at < DAY_MS
    // The newest rows always fall inside today, so they are recent whatever `now` is.
    const isNewest = sequence >= count - SEED_NEWEST_PENDING_COUNT
    const base = { id, reference: reference(sequence, at), createdAt: new Date(at).toISOString() }

    if (isCredit) {
      const status: TransactionStatus =
        isNewest || (isRecent && pendingRoll < 0.1) ? 'pending' : failedRoll < 0.04 ? 'failed' : 'successful'
      if (status === 'successful') available += creditKobo
      rows.push({
        ...base,
        type: 'credit',
        status,
        channel,
        amountKobo: creditKobo,
        description:
          channel === 'qr' ? `QR payment from ${person}`
          : channel === 'pos' ? `POS purchase, card ending ${cardLast4}`
          : channel === 'ussd' ? `USSD *894# payment from ${person}`
          : `Transfer from ${person}`,
        counterparty: { name: person, bankName, accountNumberLast4 },
        idempotencyKey: null,
        failureReason: status === 'failed' ? creditFailure : null,
      })
      return
    }

    const name = toSupplier ? supplier : person
    // A small share of debits try to spend more than is available, so the insufficient-funds
    // failure, a real case the UI must render, exists by construction rather than by luck.
    const amountKobo = overdrawRoll < 0.02 ? available + overdrawExtraKobo : debitKobo
    let status: TransactionStatus =
      isNewest || (isRecent && pendingRoll < 0.12) ? 'pending' : failedRoll < 0.05 ? 'failed' : 'successful'
    let failureReason: string | null = status === 'failed' ? debitFailure : null
    // Pending debits hold funds too, so they are checked against available balance.
    if (status !== 'failed' && amountKobo > available) {
      status = 'failed'
      failureReason = 'Insufficient funds'
    }
    if (status !== 'failed') available -= amountKobo
    rows.push({
      ...base,
      type: 'debit',
      status,
      channel: 'transfer',
      amountKobo,
      description: toSupplier ? `Payment to ${name}: ${item}` : `Transfer to ${name}`,
      counterparty: { name, bankName, accountNumberLast4 },
      idempotencyKey,
      failureReason,
    })
  })

  const newestFirst = rows.reverse()
  applyFixtures(newestFirst)
  return newestFirst
}

function applyFixtures(rows: TransactionWire[]): void {
  const at = (position: number): TransactionWire => {
    const row = rows[position]
    if (!row) throw new Error(`Seed has no row at position ${position}`)
    return row
  }
  for (const key of Object.keys(HOSTILE_DESCRIPTIONS) as (keyof typeof HOSTILE_DESCRIPTIONS)[]) {
    at(FIXTURE_POSITIONS[key]).description = HOSTILE_DESCRIPTIONS[key]
  }
  renameCounterparty(at(FIXTURE_POSITIONS.hostileCounterparty), HOSTILE_COUNTERPARTY_NAME)
  renameCounterparty(at(FIXTURE_POSITIONS.diacriticName), DIACRITIC_NAME)
}

/** Keep the description consistent when it quotes the counterparty's name. */
function renameCounterparty(row: TransactionWire, name: string): void {
  row.description = row.description.replace(row.counterparty.name, name)
  row.counterparty.name = name
}
