/**
 * Follows an accepted transfer until the bank settles it (ADR-0006).
 *
 * Listener middleware, not a component effect: a merchant who confirms a transfer and then goes to the dashboard must
 * still see the row settle. It listens to the endpoint itself, so it follows every accepted transfer, whoever sent it.
 * It asks the server for the transfer by its idempotency key, with growing gaps, until the status is no longer
 * `pending`; then it updates every cached row and refreshes the balance. If it gives up, it says so.
 *
 * Phase 6 extends this to transfers whose outcome is `unknown`. Here it only follows transfers the server accepted.
 */
import { createListenerMiddleware, type ThunkDispatch, type UnknownAction } from '@reduxjs/toolkit'
import { applyTransferToCache, novabizApi } from '../api/novabizApi'
import { transferDraft } from './transferDraftSlice'

export interface TrackingConfig {
  /** Gap before the first check, doubled after each check up to `maxIntervalMs`. */
  initialIntervalMs: number
  maxIntervalMs: number
  /** Stop checking after this long, and mark the attempt so the receipt stops promising "a few seconds". */
  giveUpAfterMs: number
}

export const DEFAULT_TRACKING_CONFIG: TrackingConfig = {
  initialIntervalMs: 2_000,
  maxIntervalMs: 10_000,
  giveUpAfterMs: 120_000,
}

type ApiState = { [novabizApi.reducerPath]: ReturnType<typeof novabizApi.reducer> }

export function createTransferTracker(config: TrackingConfig) {
  const tracker = createListenerMiddleware<ApiState, ThunkDispatch<ApiState, unknown, UnknownAction>>()

  tracker.startListening({
    matcher: novabizApi.endpoints.sendMoney.matchFulfilled,
    effect: async (action, api) => {
      if (action.payload.transfer.status !== 'pending') return
      const { idempotencyKey } = action.meta.arg.originalArgs
      const deadline = Date.now() + config.giveUpAfterMs
      let interval = config.initialIntervalMs

      while (Date.now() < deadline) {
        await api.delay(interval)
        interval = Math.min(config.maxIntervalMs, interval * 2)

        const result = await api.dispatch(novabizApi.endpoints.getTransferByKey.initiate(idempotencyKey, { subscribe: false }))
        const transfer = result.data?.transfer
        // An error or a miss proves nothing about a transfer the server already accepted: keep checking.
        if (!transfer || transfer.status === 'pending') continue

        applyTransferToCache(api.dispatch, api.getState, transfer)
        api.dispatch(transferDraft.attemptSettled({ idempotencyKey, transfer }))
        // The server's balance now reflects the outcome, including money returned by a failed settlement.
        void api.dispatch(novabizApi.endpoints.getBalance.initiate(undefined, { subscribe: false, forceRefetch: true }))
        return
      }
      api.dispatch(transferDraft.trackingStopped({ idempotencyKey }))
    },
  })

  return tracker
}
