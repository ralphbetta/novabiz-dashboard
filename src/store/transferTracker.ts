/**
 * Follows a transfer until its outcome is known (ADR-0006): reconciliation for an `unknown` transfer, and settlement
 * tracking for one the server accepted.
 *
 * Listener middleware, not a component effect: it belongs to the transfer, not to a screen, so it carries on when the
 * merchant leaves the Send Money page. Both jobs are the same loop — ask the server what happened under the
 * idempotency key, with growing gaps — and differ only in what they are waiting to learn.
 *
 * What an answer means:
 *   - the transfer, `pending`      the server has it. An unknown attempt becomes pending; keep checking.
 *   - the transfer, settled        done: write it into the cache and refresh the balance.
 *   - a rejection bound to the key done: the server proved nothing was, or ever will be, sent. Take the change back.
 *   - anything else                not an answer — a 404 only means "not yet". Keep checking. Never take the change
 *                                   back on a miss.
 *
 * Checks pause while offline or while the tab is hidden, and resume at once when either ends; paused time does not
 * count towards giving up. After about two minutes of checking, an unknown transfer `needsAttention` and a pending one
 * is marked `trackingStopped`, so the screen stops promising an answer that is not coming.
 */
import { createListenerMiddleware, type ThunkDispatch, type UnknownAction } from '@reduxjs/toolkit'
import { applyTransferToCache, discardOptimisticTransfer, novabizApi } from '../api/novabizApi'
import { toApiError } from '../lib/errors'
import { transferDraft, type TransferDraftState } from './transferDraftSlice'

export interface TrackingConfig {
  /** Ceiling of the first gap; it doubles after each check up to `maxIntervalMs`. Each gap is random below it. */
  initialIntervalMs: number
  maxIntervalMs: number
  /** Checking time, not counting pauses, after which the attempt is marked as needing attention. */
  giveUpAfterMs: number
  random: () => number
}

/** ADR-0006: 1s, 2s, 4s, 8s … capped at 30s, full jitter, for about two minutes. */
export const DEFAULT_TRACKING_CONFIG: TrackingConfig = {
  initialIntervalMs: 1_000,
  maxIntervalMs: 30_000,
  giveUpAfterMs: 120_000,
  random: Math.random,
}

type State = { transferDraft: TransferDraftState; [novabizApi.reducerPath]: ReturnType<typeof novabizApi.reducer> }

export function createTransferTracker(config: TrackingConfig) {
  const tracker = createListenerMiddleware<State, ThunkDispatch<State, unknown, UnknownAction>>()
  /** Keys being followed. A second trigger for the same key wakes the running loop instead of starting another. */
  const following = new Set<string>()
  let online = true
  let visible = true

  tracker.startListening({ actionCreator: novabizApi.internalActions.onOffline, effect: () => { online = false } })
  tracker.startListening({ actionCreator: novabizApi.internalActions.onOnline, effect: () => { online = true } })
  tracker.startListening({ actionCreator: novabizApi.internalActions.onFocusLost, effect: () => { visible = false } })
  tracker.startListening({ actionCreator: novabizApi.internalActions.onFocus, effect: () => { visible = true } })

  const follow = async (
    idempotencyKey: string,
    api: Parameters<Parameters<typeof tracker.startListening>[0]['effect']>[1],
  ) => {
    if (following.has(idempotencyKey)) return
    following.add(idempotencyKey)
    try {
      /** Wakes a wait early: back online, tab visible again, or the merchant asked to check now. */
      const checkNow = (action: UnknownAction) =>
        novabizApi.internalActions.onOnline.match(action) ||
        novabizApi.internalActions.onFocus.match(action) ||
        (transferDraft.reconciliationRestarted.match(action) && action.payload.idempotencyKey === idempotencyKey)

      let checkingMs = 0
      let attempt = 0
      while (checkingMs < config.giveUpAfterMs) {
        const ceiling = Math.min(config.maxIntervalMs, config.initialIntervalMs * 2 ** attempt)
        attempt++
        const gap = Math.floor(config.random() * ceiling)
        const started = Date.now()
        const woken = await api.take(checkNow, gap)
        if (woken) attempt = 0 // something changed: start the backoff again

        // Paused while offline or hidden. The time spent here does not count towards giving up.
        const pauseStarted = Date.now()
        while (!online || !visible) await api.take(checkNow)
        const pausedMs = Date.now() - pauseStarted

        const result = await api.dispatch(novabizApi.endpoints.getTransferByKey.initiate(idempotencyKey, { subscribe: false }))
        checkingMs += Date.now() - started - pausedMs
        const transfer = result.data?.transfer
        const status = api.getState().transferDraft.attempt

        if (transfer) {
          applyTransferToCache(api.dispatch, api.getState, transfer)
          if (transfer.status === 'pending') {
            // The server has it. An unknown attempt is now simply pending; keep following until it settles.
            if (status?.idempotencyKey === idempotencyKey && status.status === 'unknown') {
              api.dispatch(transferDraft.attemptAccepted({ idempotencyKey, transfer }))
            }
            continue
          }
          api.dispatch(transferDraft.attemptSettled({ idempotencyKey, transfer }))
          // The server's balance now reflects the outcome, including money returned by a failed settlement.
          void api.dispatch(novabizApi.endpoints.getBalance.initiate(undefined, { subscribe: false, forceRefetch: true }))
          return
        }

        // Only the server's own promise ends it: a rejection bound to the key. Not `isDefiniteFailure`, which also
        // counts a request refused unsent — for a lookup that proves nothing about the transfer.
        const bound = toApiError(result.error)
        if (bound?.error.rejected) {
          discardOptimisticTransfer(api.dispatch, api.getState, idempotencyKey)
          api.dispatch(transferDraft.attemptRejected({ idempotencyKey, message: bound.error.message }))
          return
        }
      }

      const current = api.getState().transferDraft.attempt
      if (current?.idempotencyKey !== idempotencyKey) return
      if (current.status === 'unknown') api.dispatch(transferDraft.attemptNeedsAttention({ idempotencyKey }))
      else if (current.status === 'pending') api.dispatch(transferDraft.trackingStopped({ idempotencyKey }))
    } finally {
      following.delete(idempotencyKey)
    }
  }

  // A transfer the server accepted but has not settled.
  tracker.startListening({
    matcher: novabizApi.endpoints.sendMoney.matchFulfilled,
    effect: (action, api) => {
      if (action.payload.transfer.status === 'pending') return follow(action.meta.arg.originalArgs.idempotencyKey, api)
    },
  })
  // A transfer whose outcome is unknown, one restored after a reload, or "Check status".
  tracker.startListening({ actionCreator: transferDraft.attemptUnknown, effect: (action, api) => follow(action.payload.idempotencyKey, api) })
  tracker.startListening({ actionCreator: transferDraft.attemptRestored, effect: (action, api) => follow(action.payload.idempotencyKey, api) })
  tracker.startListening({ actionCreator: transferDraft.reconciliationRestarted, effect: (action, api) => follow(action.payload.idempotencyKey, api) })

  return tracker
}
