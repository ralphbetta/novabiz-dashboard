/**
 * Keeps the idempotency key of a transfer whose outcome is open across a reload (ADR-0004, ADR-0006).
 *
 * Only the key — no amount, no account number, no name — in `sessionStorage`, which ends with the tab. If the merchant
 * reloads or the browser discards the tab mid-transfer, the outcome can still be checked instead of being lost.
 *
 * This works in the demo because the mock server's data survives a reload too (src/mocks/persistence.ts), so a restored
 * key is found, as it would be by a real server's durable idempotency store.
 */
import type { TransferDraftState } from './transferDraftSlice'

export const OPEN_TRANSFER_STORAGE_KEY = 'novabiz.openTransferKey'

/** The key to keep for this state, or null: kept while the request is in flight or its outcome is unknown. */
export function keyToKeep(state: { transferDraft: TransferDraftState }): string | null {
  const attempt = state.transferDraft.attempt
  return attempt && (attempt.status === 'sending' || attempt.status === 'unknown') ? attempt.idempotencyKey : null
}

/** Writes or clears the stored key whenever it changes. Storage can be missing or refuse writes; that only loses this. */
export function persistOpenTransferKey(store: { getState: () => { transferDraft: TransferDraftState }; subscribe: (listener: () => void) => () => void }, storage: Storage | undefined) {
  let last: string | null = null
  return store.subscribe(() => {
    const key = keyToKeep(store.getState())
    if (key === last) return
    last = key
    try {
      if (key) storage?.setItem(OPEN_TRANSFER_STORAGE_KEY, key)
      else storage?.removeItem(OPEN_TRANSFER_STORAGE_KEY)
    } catch {
      // Private mode, a full quota or blocked storage: the outcome can still be checked for as long as the tab lives.
    }
  })
}

/** The key saved before a reload, if any. */
export function readOpenTransferKey(storage: Storage | undefined): string | null {
  try {
    return storage?.getItem(OPEN_TRANSFER_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}
