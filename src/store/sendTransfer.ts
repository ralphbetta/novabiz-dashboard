/**
 * Sending a transfer from the Send Money wizard: the attempt's lifecycle (ADR-0006, ADR-0007).
 *
 * The `sendMoney` endpoint only sends the request and patches the cache. This thunk owns what the wizard's draft
 * records about it, so any other caller of the endpoint cannot take over the wizard.
 */
import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit'
import type { SendMoneyRequest } from '../api/contracts'
import { discardOptimisticTransfer, novabizApi } from '../api/novabizApi'
import type { ApiExtra } from '../api/baseQuery'
import { isDefiniteFailure, toApiError } from '../lib/errors'
import { isAttemptOpen, transferDraft, type TransferDraftState } from './transferDraftSlice'
import { selectOnline, type ConnectivityState } from './connectivitySlice'

type State = { transferDraft: TransferDraftState; connectivity?: ConnectivityState; [novabizApi.reducerPath]: ReturnType<typeof novabizApi.reducer> }

/**
 * Send once. Refused, sending nothing, while another attempt's outcome is still open: a second tap cannot create a
 * second transfer, and it would carry a new key, so the idempotency key would not catch it.
 *
 * Also refused while the browser reports no connection (ADR-0014). The Send button says so; this is the guard that
 * does not depend on the button having re-rendered. A transfer is never queued to go out later on its own.
 *
 * The key is created here, at the moment of confirming, once per attempt (ADR-0007). Resolves to the key, or null
 * when refused.
 */
export function sendTransfer({ request, idempotencyKey = crypto.randomUUID() }: { request: SendMoneyRequest; idempotencyKey?: string }): ThunkAction<Promise<string | null>, State, ApiExtra, UnknownAction> {
  return async (dispatch, getState) => {
    if (isAttemptOpen(getState().transferDraft.attempt) || !selectOnline(getState())) return null
    dispatch(transferDraft.attemptStarted({ idempotencyKey, request }))

    const result = await dispatch(novabizApi.endpoints.sendMoney.initiate({ request, idempotencyKey }))
    if (result.data) {
      dispatch(transferDraft.attemptAccepted({ idempotencyKey, transfer: result.data.transfer }))
    } else if (isDefiniteFailure(result.error)) {
      dispatch(transferDraft.attemptRejected({
        idempotencyKey,
        message: toApiError(result.error)?.error.message ?? 'The transfer could not be started. Nothing was sent.',
      }))
    } else {
      // A timeout, a dropped connection, a 5xx, a response we could not read: the money may have moved.
      dispatch(transferDraft.attemptUnknown({ idempotencyKey }))
    }
    return idempotencyKey
  }
}

/**
 * "Try again" for a transfer whose outcome is still unknown after reconciliation stopped. Sends the same request with
 * the same key (ADR-0007), which is safe either way: if the first attempt landed, the server replays it; if it never
 * did, this creates it exactly once. The optimistic change from the first attempt is still in the cache, so it is not
 * applied again. Resolves to false when there is nothing to retry — an attempt restored after a reload has no request —
 * or when the browser reports no connection.
 */
export function retryTransfer(): ThunkAction<Promise<boolean>, State, ApiExtra, UnknownAction> {
  return async (dispatch, getState) => {
    const attempt = getState().transferDraft.attempt
    if (attempt?.status !== 'unknown' || !attempt.needsAttention || !attempt.request || !selectOnline(getState())) return false
    const { idempotencyKey, request } = attempt
    dispatch(transferDraft.retryStarted({ idempotencyKey }))

    const result = await dispatch(novabizApi.endpoints.sendMoney.initiate({ request, idempotencyKey, retry: true }))
    if (result.data) {
      dispatch(transferDraft.attemptAccepted({ idempotencyKey, transfer: result.data.transfer }))
    } else if (isDefiniteFailure(result.error)) {
      // No patches to undo for a retry: take the kept change back by key.
      discardOptimisticTransfer(dispatch, getState, idempotencyKey)
      dispatch(transferDraft.attemptRejected({
        idempotencyKey,
        message: toApiError(result.error)?.error.message ?? 'The transfer could not be started. Nothing was sent.',
      }))
    } else {
      dispatch(transferDraft.attemptUnknown({ idempotencyKey }))
    }
    return true
  }
}
