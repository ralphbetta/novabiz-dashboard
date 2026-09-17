/**
 * Sending a transfer from the Send Money wizard: the attempt's lifecycle (ADR-0006, ADR-0007).
 *
 * The `sendMoney` endpoint only sends the request and patches the cache. This thunk owns what the wizard's draft
 * records about it, so any other caller of the endpoint cannot take over the wizard.
 */
import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit'
import type { SendMoneyRequest } from '../api/contracts'
import { novabizApi } from '../api/novabizApi'
import type { ApiExtra } from '../api/baseQuery'
import { isDefiniteFailure, toApiError } from '../lib/errors'
import { isAttemptOpen, transferDraft, type TransferDraftState } from './transferDraftSlice'

type State = { transferDraft: TransferDraftState; [novabizApi.reducerPath]: ReturnType<typeof novabizApi.reducer> }

/**
 * Send once. Refused, sending nothing, while another attempt's outcome is still open: a second tap cannot create a
 * second transfer, and it would carry a new key, so the idempotency key would not catch it.
 *
 * The key is created here, at the moment of confirming, once per attempt (ADR-0007). Resolves to the key, or null
 * when refused.
 */
export function sendTransfer({ request, idempotencyKey = crypto.randomUUID() }: { request: SendMoneyRequest; idempotencyKey?: string }): ThunkAction<Promise<string | null>, State, ApiExtra, UnknownAction> {
  return async (dispatch, getState) => {
    if (isAttemptOpen(getState().transferDraft.attempt)) return null
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
