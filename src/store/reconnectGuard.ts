/**
 * On reconnect, reconcile first, then refetch (ADR-0006).
 *
 * On reconnect RTK Query refetches every live query, replacing the cached balance and pages with the server's copy.
 * While a transfer is in flight, or its outcome is unknown, that would silently drop the optimistic change that is
 * deliberately kept: the receipt would say "may already have been sent" while the balance says nothing moved.
 *
 * So the `onOnline` action is held here. The transfer tracker, which sits before this middleware, still sees it and
 * checks the unknown transfer at once; when that settles the outcome — or reconciliation stops and the attempt needs
 * attention — the held reconnect is released and the refetch happens then. If the connection drops again first, the
 * held reconnect is dropped and the next one decides. RTK only records the online flag; nothing else waits on it.
 */
import type { Middleware } from '@reduxjs/toolkit'
import { novabizApi } from '../api/novabizApi'
import type { TransferDraftState } from './transferDraftSlice'

type State = { transferDraft: TransferDraftState }

/** Sending, or unknown and still being reconciled. Once it needs attention, the server's figures are the best there are. */
const outcomeOpen = (state: State) => {
  const attempt = state.transferDraft.attempt
  return attempt?.status === 'sending' || (attempt?.status === 'unknown' && !attempt.needsAttention)
}

export const reconnectGuard: Middleware<object, State> = (store) => {
  let held = false
  return (next) => (action) => {
    if (novabizApi.internalActions.onOnline.match(action) && outcomeOpen(store.getState())) {
      held = true
      return action
    }
    // Offline again: the held reconnect is stale. The next real reconnect will be held or passed on its own.
    if (novabizApi.internalActions.onOffline.match(action)) held = false
    const result = next(action)
    if (held && !outcomeOpen(store.getState())) {
      held = false
      store.dispatch(novabizApi.internalActions.onOnline())
    }
    return result
  }
}
