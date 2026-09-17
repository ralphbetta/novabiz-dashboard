/**
 * The Send Money draft and its current attempt (ADR-0004, ADR-0006, ADR-0007).
 *
 * Client-only state, kept in the store rather than in the wizard component so that a merchant who leaves the page
 * mid-transfer comes back to the same step, and so that a transfer's outcome is recorded even when no screen is
 * showing it. Never persisted: a half-entered draft holds a recipient's account number (ADR-0004).
 *
 * The attempt carries the idempotency key. The key is created once, when the merchant confirms, and belongs to that
 * attempt for its whole life (ADR-0007). Editing the transfer after a definite failure starts a new attempt, with a
 * new key, because it is a different intent.
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { SendMoneyRequest, Transaction } from '../api/contracts'

export type WizardStep = 'recipient' | 'amount' | 'review' | 'result'

/**
 * `sending`    — the request is in flight.
 * `pending`    — the server accepted it; the bank has not settled it yet.
 * `successful` — settled.
 * `failed`     — definitely not sent (the server rejected it), or accepted and then failed to settle.
 * `unknown`    — the request may or may not have gone through: a timeout, a dropped connection, a 5xx.
 *                The optimistic change is kept, the merchant is told not to send again, and the transfer tracker
 *                asks the server what happened under the key until it knows (ADR-0006). If it cannot find out in
 *                about two minutes, the attempt `needsAttention`: the merchant can check again or try again with
 *                the same key.
 */
export type AttemptStatus = 'sending' | 'pending' | 'successful' | 'failed' | 'unknown'

export interface Recipient {
  accountNumber: string
  bankCode: string
  /** The verified holder's name from the account lookup (ADR-0018). Empty until the account is verified. */
  accountName: string
}

export interface AttemptFailure {
  message: string
  /** True when the server accepted the transfer and it later failed to settle, so money was returned. */
  afterAcceptance: boolean
}

export interface TransferAttempt {
  idempotencyKey: string
  /**
   * What was sent. Null for an attempt restored after a reload: only the key is kept across one (ADR-0004), so the
   * outcome can still be checked, but the details — an account number, a name — are not stored.
   */
  request: SendMoneyRequest | null
  status: AttemptStatus
  /** The bank reference, once the server has created the transfer. */
  reference: string | null
  failure: AttemptFailure | null
  /** True once the tracker has stopped checking a transfer that is still pending (ADR-0006). */
  trackingStopped: boolean
  /** True once reconciliation has stopped without an answer for an `unknown` transfer (ADR-0006). */
  needsAttention: boolean
}

export interface TransferDraftState {
  step: WizardStep
  recipient: Recipient
  /** Exactly what the merchant typed, so going back shows their own input. Parsed to kobo at each check. */
  amountInput: string
  narration: string
  attempt: TransferAttempt | null
}

export const initialTransferDraft: TransferDraftState = {
  step: 'recipient',
  recipient: { accountNumber: '', bankCode: '', accountName: '' },
  amountInput: '',
  narration: '',
  attempt: null,
}

/** An attempt whose outcome is still open: the draft behind it must not be edited or replaced. */
export function isAttemptOpen(attempt: TransferAttempt | null): boolean {
  return attempt !== null && (attempt.status === 'sending' || attempt.status === 'pending' || attempt.status === 'unknown')
}

type KeyedTransfer = { idempotencyKey: string; transfer: Pick<Transaction, 'reference' | 'status' | 'failureReason'> }

function applyTransfer(attempt: TransferAttempt, transfer: KeyedTransfer['transfer']) {
  attempt.reference = transfer.reference
  attempt.status = transfer.status
  attempt.failure = transfer.status === 'failed'
    ? { message: transfer.failureReason ?? 'The bank could not complete this transfer', afterAcceptance: true }
    : null
}

export const transferDraftSlice = createSlice({
  name: 'transferDraft',
  initialState: initialTransferDraft,
  reducers: {
    recipientSaved(state, action: PayloadAction<Recipient>) {
      if (isAttemptOpen(state.attempt)) return
      state.recipient = action.payload
      state.attempt = null
      state.step = 'amount'
    },
    /**
     * The recipient as it stands while the merchant is still on step 1, including the verified name once the lookup
     * returns (empty until then). Lets the summary fill in as they go.
     */
    recipientEdited(state, action: PayloadAction<Recipient>) {
      if (isAttemptOpen(state.attempt)) return
      state.recipient = action.payload
    },
    amountSaved(state, action: PayloadAction<{ amountInput: string; narration: string }>) {
      if (isAttemptOpen(state.attempt)) return
      state.amountInput = action.payload.amountInput
      state.narration = action.payload.narration
      state.attempt = null
      state.step = 'review'
    },
    /** Keeps what the merchant typed on the amount step when they go back, without validating it. */
    amountEdited(state, action: PayloadAction<{ amountInput: string; narration: string }>) {
      if (isAttemptOpen(state.attempt)) return
      state.amountInput = action.payload.amountInput
      state.narration = action.payload.narration
    },
    /** Back, or "Change" on the review step. Not allowed while an attempt's outcome is open. */
    stepChanged(state, action: PayloadAction<Exclude<WizardStep, 'result'>>) {
      if (isAttemptOpen(state.attempt)) return
      state.attempt = null
      state.step = action.payload
    },

    /** Refused while another attempt's outcome is open, so it can never be silently replaced. */
    attemptStarted(state, action: PayloadAction<{ idempotencyKey: string; request: SendMoneyRequest }>) {
      if (isAttemptOpen(state.attempt)) return
      state.attempt = { ...action.payload, status: 'sending', reference: null, failure: null, trackingStopped: false, needsAttention: false }
      state.step = 'result'
    },
    /** The server created the transfer. Usually `pending`; a replayed key can return it already settled. */
    attemptAccepted(state, action: PayloadAction<KeyedTransfer>) {
      if (state.attempt?.idempotencyKey !== action.payload.idempotencyKey) return
      applyTransfer(state.attempt, action.payload.transfer)
    },
    /** A later status for an accepted transfer, found by the transfer tracker. */
    attemptSettled(state, action: PayloadAction<KeyedTransfer>) {
      if (state.attempt?.idempotencyKey !== action.payload.idempotencyKey) return
      applyTransfer(state.attempt, action.payload.transfer)
    },
    /** The server said no, and promised nothing was or will be sent under this key. */
    attemptRejected(state, action: PayloadAction<{ idempotencyKey: string; message: string }>) {
      if (state.attempt?.idempotencyKey !== action.payload.idempotencyKey) return
      state.attempt.status = 'failed'
      state.attempt.failure = { message: action.payload.message, afterAcceptance: false }
    },
    /** The tracker gave up while the transfer is still pending: say so, rather than "a few seconds" forever. */
    trackingStopped(state, action: PayloadAction<{ idempotencyKey: string }>) {
      if (state.attempt?.idempotencyKey !== action.payload.idempotencyKey || state.attempt.status !== 'pending') return
      state.attempt.trackingStopped = true
    },
    attemptUnknown(state, action: PayloadAction<{ idempotencyKey: string }>) {
      if (state.attempt?.idempotencyKey !== action.payload.idempotencyKey) return
      state.attempt.status = 'unknown'
      state.attempt.needsAttention = false
    },
    /** Reconciliation stopped without an answer. The outcome is still unknown; the optimistic change is still kept. */
    attemptNeedsAttention(state, action: PayloadAction<{ idempotencyKey: string }>) {
      if (state.attempt?.idempotencyKey !== action.payload.idempotencyKey || state.attempt.status !== 'unknown') return
      state.attempt.needsAttention = true
    },
    /** "Check status": the tracker starts asking again. */
    reconciliationRestarted(state, action: PayloadAction<{ idempotencyKey: string }>) {
      if (state.attempt?.idempotencyKey !== action.payload.idempotencyKey) return
      state.attempt.needsAttention = false
      state.attempt.trackingStopped = false
    },
    /** "Try again" on an unknown attempt: the same request, with the same key (ADR-0007). */
    retryStarted(state, action: PayloadAction<{ idempotencyKey: string }>) {
      if (state.attempt?.idempotencyKey !== action.payload.idempotencyKey || state.attempt.status !== 'unknown') return
      state.attempt.status = 'sending'
      state.attempt.needsAttention = false
    },
    /**
     * After a reload: an attempt whose outcome was open when the page went away, known only by its key. Shown as
     * unknown, and checked like any other.
     */
    attemptRestored(state, action: PayloadAction<{ idempotencyKey: string }>) {
      if (state.attempt) return
      state.attempt = {
        idempotencyKey: action.payload.idempotencyKey, request: null, status: 'unknown', reference: null, failure: null,
        trackingStopped: false, needsAttention: false,
      }
      state.step = 'result'
    },

    /** "Edit transfer" after a definite failure: back to review with the details kept, and no attempt. */
    editAfterFailure(state) {
      if (state.attempt?.status !== 'failed') return
      state.attempt = null
      state.step = 'review'
    },
    /**
     * "Send another": a blank draft. Refused only while the request is in flight. An accepted (`pending`) transfer is
     * tracked by the transfer tracker whatever the draft holds, and an `unknown` one is the merchant's call — the
     * result screen warns them first.
     */
    draftReset(state) {
      if (state.attempt?.status === 'sending') return
      return initialTransferDraft
    },
  },
})

export const transferDraft = transferDraftSlice.actions
