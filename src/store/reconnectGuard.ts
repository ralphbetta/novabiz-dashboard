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
 *
 * One exception is refetched at once: a read that failed with nothing cached, typically a page opened while offline.
 * It holds no optimistic change to lose, and read retries stop while offline (ADR-0014), so without this it would stay
 * failed until reconciliation ends — up to about two minutes. A failed read that still has data (the balance card after
 * a refresh failed offline) keeps its data and waits: refetching it is exactly what would drop the kept change.
 */
import type { Middleware } from '@reduxjs/toolkit'
import { novabizApi } from '../api/novabizApi'
import type { TransferDraftState } from './transferDraftSlice'

type State = { transferDraft: TransferDraftState; [novabizApi.reducerPath]: ReturnType<typeof novabizApi.reducer> }
type Endpoints = Record<string, { initiate: (args: unknown, options: { subscribe: boolean; forceRefetch: boolean }) => never }>

/** Reads that failed with nothing cached. Reconciliation lookups are left to the transfer tracker, which paces them. */
function failedEmptyReads(state: State) {
  return Object.values(state[novabizApi.reducerPath].queries).filter(
    (query) => query?.status === 'rejected' && query.data === undefined && query.endpointName !== 'getTransferByKey',
  )
}

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
      for (const query of failedEmptyReads(store.getState())) {
        const endpoint = query?.endpointName ? (novabizApi.endpoints as unknown as Endpoints)[query.endpointName] : undefined
        if (endpoint) store.dispatch(endpoint.initiate(query?.originalArgs, { subscribe: false, forceRefetch: true }))
      }
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
