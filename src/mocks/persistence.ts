/**
 * Keeps the mock server's data across reloads (ADR-0005).
 *
 * The mock stands in for a bank's servers, and a server does not forget a transfer because a browser tab reloaded. So
 * the whole mock database — the ledger, idempotency records, pending settlements and beneficiaries — is saved to
 * `localStorage` and restored on start. Without it, a reload wiped every transfer the merchant had made, and an
 * unconfirmed transfer restored after a reload could never be found by reconciliation.
 *
 * Saved data is untrusted input: it is validated on load, and anything malformed, from an older version, or seeded
 * differently is discarded in favour of the seed. A storage failure — private mode, a full quota — only means the data
 * is not kept; the mock carries on in memory.
 *
 * Stand-in only. In production this data lives on the bank's servers; nothing like it would be stored in a browser.
 */
import { z } from 'zod'
import { BeneficiarySchema, TransactionSchema } from '../api/contracts'
import { MOCK_DB_SNAPSHOT_VERSION, type MockDbSnapshot } from './db'
import { SEED } from './seed'
import { OPEN_TRANSFER_STORAGE_KEY } from '../store/openTransferKey'

export const MOCK_DB_STORAGE_KEY = 'novabiz.mockDb'

const settlement = z.object({ settlesAt: z.number().finite(), useHook: z.boolean() })
const failure = z.object({
  ok: z.literal(false),
  code: z.enum(['VALIDATION_FAILED', 'INSUFFICIENT_FUNDS', 'IDEMPOTENCY_KEY_REUSED', 'NOT_FOUND', 'INTERNAL_ERROR']),
  message: z.string(),
  fieldErrors: z.record(z.string(), z.string()).optional(),
})
const idempotencyRecord = z.object({
  fingerprint: z.string().nullable(),
  outcome: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('transfer'), transferId: z.string().min(1) }),
    z.object({ kind: z.literal('rejected'), failure }),
  ]),
})

/** Validates the shape and every row against the API contract, without transforming anything. */
const SnapshotSchema = z.object({
  version: z.literal(MOCK_DB_SNAPSHOT_VERSION),
  seed: z.literal(SEED),
  transactions: z.array(z.unknown()).refine((rows) => rows.every((row) => TransactionSchema.safeParse(row).success), 'invalid transaction'),
  nextSequence: z.int().min(0),
  settlements: z.array(z.tuple([z.string(), settlement])),
  idempotency: z.array(z.tuple([z.string(), idempotencyRecord])),
  beneficiaries: z.array(z.unknown()).refine((rows) => rows.every((row) => BeneficiarySchema.safeParse(row).success), 'invalid beneficiary'),
})

/** The saved database, or null when there is none or it cannot be trusted. */
export function loadMockDbSnapshot(storage: Storage | undefined): MockDbSnapshot | null {
  try {
    const raw = storage?.getItem(MOCK_DB_STORAGE_KEY)
    if (!raw) return null
    const parsed = SnapshotSchema.safeParse(JSON.parse(raw))
    // The schema has checked every field; the rows were checked against the contract and are kept exactly as saved.
    return parsed.success ? (parsed.data as MockDbSnapshot) : null
  } catch {
    return null
  }
}

export function saveMockDbSnapshot(storage: Storage | undefined, snapshot: MockDbSnapshot): void {
  try {
    storage?.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // Private mode or a full quota: the data is not kept, and the mock carries on in memory.
  }
}

export function clearMockDbSnapshot(storage: Storage | undefined): void {
  try {
    storage?.removeItem(MOCK_DB_STORAGE_KEY)
  } catch {
    // Nothing to clear.
  }
}

/**
 * The browser's saving of the mock database: after requests, on `pagehide`, and a reset.
 *
 * - A request that may have written — anything but a GET — is saved at once, so reloading straight after sending money
 *   cannot lose it. Reads can still change the data (a pending transfer settles when it is next read), so they are
 *   saved too, at most once per `delayMs`.
 * - A save is skipped when this tab's data is unchanged since it last saved. Each tab holds its own copy (the mock
 *   supports one tab; see ADR-0005), and without this a tab that only read would overwrite a transfer made in another.
 * - `reset` clears the saved database and blocks every later save — one already scheduled, one from a request that
 *   finishes before the page unloads, and the `pagehide` save — so none can write the old data back. It also forgets
 *   the app's open-transfer key, which would otherwise be checked against the fresh data and end in "needs attention".
 */
export function createMockPersistence({ local, session, snapshot, delayMs = 250 }: {
  local: Storage | undefined
  session?: Storage | undefined
  snapshot: () => MockDbSnapshot
  delayMs?: number
}) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let resetting = false
  let lastSaved: string | null = null

  const save = () => {
    clearTimeout(timer)
    timer = undefined
    if (resetting) return
    const json = JSON.stringify(snapshot())
    if (json === lastSaved) return
    try {
      local?.setItem(MOCK_DB_STORAGE_KEY, json)
      lastSaved = json
    } catch {
      // Private mode or a full quota: the data is not kept, and the mock carries on in memory.
    }
  }

  return {
    save,
    afterProcessing(request: Request) {
      if (request.method !== 'GET') {
        save()
        return
      }
      timer ??= setTimeout(save, delayMs)
    },
    reset() {
      resetting = true
      clearTimeout(timer)
      timer = undefined
      clearMockDbSnapshot(local)
      try {
        session?.removeItem(OPEN_TRANSFER_STORAGE_KEY)
      } catch {
        // Nothing to forget.
      }
    },
  }
}
