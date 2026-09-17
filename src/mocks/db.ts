/**
 * The mock server's state and business rules (ADR-0005), with no HTTP or MSW in it.
 *
 * Kept framework-free so every rule is unit-testable against an injected clock. handlers.ts is a thin
 * HTTP layer over this. All operations are synchronous: check-then-write can never interleave with
 * another request, so two submits with the same idempotency key cannot both write, even though MSW
 * handlers are async. Anything that must await — simulated latency, in Part 3 — belongs in the
 * handler, BEFORE calling in here, never between a check and its write.
 *
 * Known limitation: state lives in page memory. A reload or a second tab starts a fresh server that has
 * forgotten every transfer and key created before it. A real server is durable; this one is not.
 */
import {
  type AccountLookupQuery,
  type AccountLookupWire,
  type BalanceWire,
  type BeneficiariesWire,
  type BeneficiaryWire,
  type ErrorCode,
  type SendMoneyRequest,
  type TransactionQuery,
  type TransactionWire,
  type TransactionsPageWire,
} from '../api/contracts'
import { DAY_MS, dayBounds, startOfDay } from '../lib/time'
import { BANKS } from '../api/banks'
import { sanitizeText } from '../lib/sanitize'
import { KNOWN_ACCOUNTS, accountHolder } from './directory'
import { SEED, SEED_TRANSACTION_COUNT, generateSeedTransactions, reference, rowRng, sequenceId } from './seed'

export const DEFAULT_SETTLEMENT_DELAY_MS = 3000
/** Pending seed rows settle this long after the mock starts, so they are visible first, then resolve. */
export const SEED_PENDING_SETTLEMENT_DELAY_MS = 5 * 60 * 1000

export type Failure = { ok: false; code: ErrorCode; message: string; fieldErrors?: Record<string, string> }
export type Result<T> = { ok: true; value: T } | Failure

const fail = (code: ErrorCode, message: string, fieldErrors?: Record<string, string>): Failure =>
  fieldErrors ? { ok: false, code, message, fieldErrors } : { ok: false, code, message }

/** How an accepted transfer resolves once its settlement delay has passed. Part 3's chaos controls set this. */
export type SettlementOutcome = { status: 'successful' } | { status: 'failed'; reason: string }

export interface MockDbOptions {
  now: () => Date
  seed?: number
  settlementDelayMs?: number
  settlementOutcome?: (transfer: TransactionWire) => SettlementOutcome
  /** Start from saved state instead of the seed, so the mock survives a reload (see persistence.ts). */
  snapshot?: MockDbSnapshot
}

/** What processing an idempotency key produced: a created transfer, or a rejection bound to the key. */
export type KeyOutcome = { kind: 'transfer'; transferId: string } | { kind: 'rejected'; failure: Failure }
export interface IdempotencyRecord { fingerprint: string | null; outcome: KeyOutcome }
export interface Settlement { settlesAt: number; useHook: boolean }

/** Bump when the shape changes: an older snapshot is then discarded and the seed is used. */
export const MOCK_DB_SNAPSHOT_VERSION = 1

/** Everything the mock server knows, as plain JSON. */
export interface MockDbSnapshot {
  version: typeof MOCK_DB_SNAPSHOT_VERSION
  seed: number
  transactions: TransactionWire[]
  nextSequence: number
  settlements: [string, Settlement][]
  idempotency: [string, IdempotencyRecord][]
  beneficiaries: BeneficiaryWire[]
}

export interface TransferResult {
  transfer: TransactionWire
  /** True when an earlier request with the same key and payload already created this transfer. */
  replayed: boolean
}

// ---------------------------------------------------------------------------
// Cursor
//
// Keyset pagination on (createdAt, id), newest first. Never createdAt alone: timestamps tie (at
// midnight WAT every seed row for the day shares one instant), and a createdAt-only cursor would skip
// or repeat rows at a page boundary. Opaque to the client: base64url of a small JSON object.
// ---------------------------------------------------------------------------

interface CursorKey {
  createdAt: string
  id: string
}

export function encodeCursor(key: CursorKey): string {
  return btoa(JSON.stringify([key.createdAt, key.id])).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function decodeCursor(cursor: string): CursorKey | null {
  try {
    const padded = cursor.replaceAll('-', '+').replaceAll('_', '/')
    const parsed: unknown = JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)))
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      return { createdAt: parsed[0], id: parsed[1] }
    }
    return null
  } catch {
    return null
  }
}

/** Newest first: later createdAt first; for equal createdAt, larger id first. */
function compareNewestFirst(a: CursorKey, b: CursorKey): number {
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt ? -1 : 1
  if (a.id !== b.id) return a.id > b.id ? -1 : 1
  return 0
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export function createMockDb(options: MockDbOptions) {
  const { now, seed = SEED, settlementDelayMs = DEFAULT_SETTLEMENT_DELAY_MS } = options
  const settlementOutcome = options.settlementOutcome ?? (() => ({ status: 'successful' }) as const)

  const { snapshot } = options
  const transactions: TransactionWire[] = snapshot ? structuredClone(snapshot.transactions) : generateSeedTransactions({ now: now(), seed })
  /** Continues the seed's id sequence, so every new id sorts after every seed id. */
  let nextSequence = snapshot ? snapshot.nextSequence : SEED_TRANSACTION_COUNT
  /**
   * Settlement schedule. `useHook` is false for seed rows, which always settle successfully; the
   * outcome hook is for API-created transfers, where Part 3's chaos controls plug in.
   */
  const settlements = new Map<string, Settlement>(snapshot ? structuredClone(snapshot.settlements) : [])

  /**
   * Idempotency key -> what processing that key produced, and a fingerprint of the payload.
   *
   * Both outcomes are bound: a created transfer, AND a rejection reached during processing. Binding the
   * rejection is what lets INSUFFICIENT_FUNDS promise "no transfer will ever exist under this key"
   * (REJECTED_BY_CODE): without it, an original attempt still in flight could land after a retry was
   * refused and succeed. A `null` fingerprint marks a key with no known payload (seed rows): any request
   * reusing it is a conflict.
   */
  const idempotency = new Map<string, IdempotencyRecord>(snapshot ? structuredClone(snapshot.idempotency) : [])

  // Seed rows that carry a key are registered, so they can be looked up and their keys cannot be reused.
  // Pending seed rows get a settlement schedule, so they do not hold funds forever.
  const startedAt = now().getTime()
  for (const t of snapshot ? [] : transactions) {
    if (t.idempotencyKey !== null) {
      idempotency.set(t.idempotencyKey, { fingerprint: null, outcome: { kind: 'transfer', transferId: t.id } })
    }
    if (t.status === 'pending') {
      settlements.set(t.id, { settlesAt: startedAt + SEED_PENDING_SETTLEMENT_DELAY_MS, useHook: false })
    }
  }

  const byId = (id: string) => transactions.find((t) => t.id === id)

  /**
   * Settle every transfer whose delay has passed. Lazy, rather than timer-driven: it runs at the start
   * of every operation, so it is deterministic under an injected clock and needs no timers that could
   * outlive a test or a page.
   */
  function settleDue(): void {
    const nowMs = now().getTime()
    for (const [id, { settlesAt, useHook }] of settlements) {
      if (settlesAt > nowMs) continue
      const transfer = byId(id)
      if (!transfer || transfer.status !== 'pending') {
        settlements.delete(id)
        continue
      }
      let outcome: SettlementOutcome
      try {
        outcome = useHook ? settlementOutcome(structuredClone(transfer)) : { status: 'successful' }
      } catch (error) {
        // Leave it scheduled: it is retried on the next operation. Deleting the schedule first would
        // strand the transfer as pending with its funds held forever; rethrowing would let one faulty
        // settlement take down every read.
        console.error(`[mock api] settlement outcome threw for ${id}; will retry`, error)
        continue
      }
      settlements.delete(id)
      transfer.status = outcome.status
      transfer.failureReason = outcome.status === 'failed' ? outcome.reason : null
    }
  }

  /**
   * Payees the merchant has paid before, newest first. Seeded with the fixed directory accounts, paid on earlier days;
   * every transfer the server accepts moves its recipient to the front.
   */
  const beneficiaries: BeneficiaryWire[] = snapshot ? structuredClone(snapshot.beneficiaries) : Object.entries(KNOWN_ACCOUNTS).map(([key, accountName], index) => {
    const [bankCode = '', accountNumber = ''] = key.split(':')
    return { bankCode, accountNumber, accountName, lastPaidAt: new Date(now().getTime() - (index + 1) * DAY_MS).toISOString() }
  })
  const MAX_BENEFICIARIES = 12

  function rememberBeneficiary(recipient: SendMoneyRequest['recipient'], at: Date) {
    const existing = beneficiaries.findIndex((b) => b.bankCode === recipient.bankCode && b.accountNumber === recipient.accountNumber)
    if (existing !== -1) beneficiaries.splice(existing, 1)
    beneficiaries.unshift({ ...recipient, lastPaidAt: at.toISOString() })
    beneficiaries.length = Math.min(beneficiaries.length, MAX_BENEFICIARIES)
  }

  /** Names match when they are the same once sanitised and compared without case. */
  const sameName = (a: string, b: string) => sanitizeText(a).toLocaleLowerCase('en-NG') === sanitizeText(b).toLocaleLowerCase('en-NG')

  function computeBalance(): BalanceWire {
    const at = now()
    const dayStart = startOfDay(at).toISOString()
    const asOf = at.toISOString()
    let ledger = 0
    let pendingDebits = 0
    let todayInflow = 0
    let todayOutflow = 0
    for (const t of transactions) {
      const today = t.createdAt >= dayStart && t.createdAt <= asOf
      if (t.status === 'successful') {
        ledger += t.type === 'credit' ? t.amountKobo : -t.amountKobo
        if (today) {
          if (t.type === 'credit') todayInflow += t.amountKobo
          else todayOutflow += t.amountKobo
        }
      } else if (t.status === 'pending' && t.type === 'debit') {
        pendingDebits += t.amountKobo
      }
    }
    return {
      ledgerBalanceKobo: ledger,
      availableBalanceKobo: ledger - pendingDebits,
      todayInflowKobo: todayInflow,
      todayOutflowKobo: todayOutflow,
      asOf,
    }
  }

  return {
    getBalance(): Result<BalanceWire> {
      settleDue()
      return { ok: true, value: computeBalance() }
    },

    listTransactions(query: TransactionQuery): Result<TransactionsPageWire> {
      settleDue()
      let after: CursorKey | null = null
      if (query.cursor !== undefined) {
        after = decodeCursor(query.cursor)
        if (!after) return fail('VALIDATION_FAILED', 'Invalid cursor', { cursor: 'Invalid cursor' })
      }
      const from = query.from === undefined ? undefined : dayBounds(query.from).start.toISOString()
      const toExclusive = query.to === undefined ? undefined : dayBounds(query.to).endExclusive.toISOString()

      const matching = transactions
        .filter(
          (t) =>
            (query.status === undefined || t.status === query.status) &&
            (query.type === undefined || t.type === query.type) &&
            (from === undefined || t.createdAt >= from) &&
            (toExclusive === undefined || t.createdAt < toExclusive),
        )
        .sort(compareNewestFirst)

      const start = after === null ? 0 : matching.findIndex((t) => compareNewestFirst(t, after) > 0)
      const remaining = start === -1 ? [] : matching.slice(start)
      const items = remaining.slice(0, query.limit)
      const last = items.at(-1)
      return {
        ok: true,
        value: {
          items: structuredClone(items),
          nextCursor: remaining.length > query.limit && last ? encodeCursor(last) : null,
          totalCount: matching.length,
        },
      }
    },

    createTransfer(request: SendMoneyRequest, idempotencyKey: string): Result<TransferResult> {
      settleDue()
      const fingerprint = JSON.stringify([
        request.recipient.accountNumber,
        request.recipient.bankCode,
        request.recipient.accountName,
        request.amountKobo,
        // Omitted, empty and whitespace-only narration are the same payload (the schema trims).
        request.narration || null,
      ])

      const prior = idempotency.get(idempotencyKey)
      if (prior) {
        if (prior.fingerprint === null || prior.fingerprint !== fingerprint) {
          // Something already exists under this key, so this is not "nothing was written":
          // REJECTED_BY_CODE marks it rejected: false, and the client must look the key up.
          return fail(
            'IDEMPOTENCY_KEY_REUSED',
            'This idempotency key was already used for a different request. Check its status before retrying.',
          )
        }
        if (prior.outcome.kind === 'rejected') return prior.outcome.failure
        const existing = byId(prior.outcome.transferId)
        if (!existing) return fail('INTERNAL_ERROR', 'Idempotency record points at a missing transfer')
        return { ok: true, value: { transfer: structuredClone(existing), replayed: true } }
      }

      /** Refuse, and bind the refusal to the key so it can never later become a success. */
      const reject = (failure: Failure): Failure => {
        idempotency.set(idempotencyKey, { fingerprint, outcome: { kind: 'rejected', failure } })
        return failure
      }

      const bank = BANKS.find((b) => b.code === request.recipient.bankCode)
      if (!bank) return reject(fail('VALIDATION_FAILED', 'Unknown bank', { 'recipient.bankCode': 'Select a bank' }))

      // The name must be the one the recipient's bank holds (ADR-0018). The client shows the looked-up name, but the
      // server does not trust the client to have done so.
      const holder = accountHolder(bank.code, request.recipient.accountNumber)
      if (holder === null) {
        return reject(fail('VALIDATION_FAILED', 'No account was found with this number at this bank. Nothing was sent.', {
          'recipient.accountNumber': 'No account found',
        }))
      }
      if (!sameName(holder, request.recipient.accountName)) {
        return reject(fail('VALIDATION_FAILED', 'The account name does not match this account. Nothing was sent.', {
          'recipient.accountName': 'Does not match the account holder',
        }))
      }

      const { availableBalanceKobo } = computeBalance()
      if (request.amountKobo > availableBalanceKobo) {
        return reject(fail('INSUFFICIENT_FUNDS', 'Insufficient funds for this transfer. Nothing was sent.'))
      }

      const at = now()
      const sequence = nextSequence++
      const transfer: TransactionWire = {
        id: sequenceId(sequence, rowRng(seed, sequence)),
        reference: reference(sequence, at.getTime()),
        type: 'debit',
        status: 'pending',
        channel: 'transfer',
        amountKobo: request.amountKobo,
        description: request.narration || `Transfer to ${request.recipient.accountName}`,
        counterparty: {
          name: request.recipient.accountName,
          bankName: bank.name,
          accountNumberLast4: request.recipient.accountNumber.slice(-4),
        },
        createdAt: at.toISOString(),
        idempotencyKey,
        failureReason: null,
      }
      transactions.push(transfer)
      idempotency.set(idempotencyKey, { fingerprint, outcome: { kind: 'transfer', transferId: transfer.id } })
      settlements.set(transfer.id, { settlesAt: at.getTime() + settlementDelayMs, useHook: true })
      rememberBeneficiary({ ...request.recipient, accountName: holder }, at)
      return { ok: true, value: { transfer: structuredClone(transfer), replayed: false } }
    },

    /** Name enquiry (ADR-0018): who holds this account? NOT_FOUND when nobody does. */
    lookupAccount(query: AccountLookupQuery): Result<AccountLookupWire> {
      if (!BANKS.some((b) => b.code === query.bankCode)) {
        return fail('VALIDATION_FAILED', 'Unknown bank', { bankCode: 'Select a bank' })
      }
      const accountName = accountHolder(query.bankCode, query.accountNumber)
      if (accountName === null) return fail('NOT_FOUND', 'No account was found with this number at this bank.')
      return { ok: true, value: { ...query, accountName } }
    },

    /** Everything, as plain JSON, to save and restore with `createMockDb({ snapshot })`. */
    snapshot(): MockDbSnapshot {
      return structuredClone({
        version: MOCK_DB_SNAPSHOT_VERSION,
        seed,
        transactions,
        nextSequence,
        settlements: [...settlements.entries()],
        idempotency: [...idempotency.entries()],
        beneficiaries,
      })
    },

    listBeneficiaries(): Result<BeneficiariesWire> {
      return { ok: true, value: { items: structuredClone(beneficiaries) } }
    },

    /**
     * The reconciliation lookup (ADR-0006): what happened under this key?
     *
     * Three answers, and only two are conclusive:
     *   - the transfer, in its current state;
     *   - the rejection bound to the key — conclusive: nothing exists and nothing ever will;
     *   - NOT_FOUND — NOT conclusive. The original request may still be in flight, so a miss must never
     *     be read as "nothing was written". REJECTED_BY_CODE marks it rejected: false.
     */
    findTransferByKey(idempotencyKey: string): Result<TransactionWire> {
      settleDue()
      const record = idempotency.get(idempotencyKey)
      if (!record) {
        return fail('NOT_FOUND', 'No transfer has been received with this idempotency key yet. It may still be in progress.')
      }
      if (record.outcome.kind === 'rejected') return record.outcome.failure
      const transfer = byId(record.outcome.transferId)
      if (!transfer) return fail('INTERNAL_ERROR', 'Idempotency record points at a missing transfer')
      return { ok: true, value: structuredClone(transfer) }
    },
  }
}

export type MockDb = ReturnType<typeof createMockDb>
