/**
 * Holds back the reconnect refetch while a transfer's outcome is open (ADR-0006).
 *
 * On reconnect RTK Query refetches every live query, replacing the cached balance and pages with the server's copy.
 * While a transfer is in flight, or its outcome is unknown, that would silently drop the optimistic change that is
 * deliberately kept: the receipt would say "may already have been sent" while the balance says nothing moved.
 *
 * So the `onOnline` action is held until the outcome is known (or the merchant starts over), then released, and the
 * refetch happens then — unless the connection dropped again in the meantime, in which case the next reconnect decides.
 * RTK only records the online flag; nothing else waits on it. Phase 6 replaces the wait with reconciling the unknown
 * transfer first.
 *
 * Known gap until then: an `unknown` attempt only ends when the merchant starts a different transfer, so a merchant who
 * leaves for the dashboard keeps the hold, and later reconnects do not refresh the balance or table.
 */
import type { Middleware } from '@reduxjs/toolkit'
import { novabizApi } from '../api/novabizApi'
import type { TransferDraftState } from './transferDraftSlice'

type State = { transferDraft: TransferDraftState }

const outcomeOpen = (state: State) => {
  const status = state.transferDraft.attempt?.status
  return status === 'sending' || status === 'unknown'
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
