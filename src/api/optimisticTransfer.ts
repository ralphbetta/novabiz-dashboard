/**
 * The optimistic row for a transfer the merchant has just confirmed (ADR-0006), and which cached pages it belongs on.
 *
 * Pure functions: the cache patching that uses them lives with the endpoint in novabizApi.ts.
 */
import { bankByCode } from './banks'
import type { SendMoneyRequest, Transaction } from './contracts'
import type { TransactionFilters } from './novabizApi'
import { calendarDate } from '../lib/time'

/** Shown in the Reference column until the server assigns the real reference. */
export const OPTIMISTIC_REFERENCE = 'Processing'

/**
 * A pending debit shaped like the one the mock server creates, so the row does not jump when the real one replaces
 * it. Matched to the server's row by idempotency key, never by id.
 */
export function optimisticTransaction(request: SendMoneyRequest, idempotencyKey: string, now: Date): Transaction {
  return {
    id: `optimistic-${idempotencyKey}`,
    reference: OPTIMISTIC_REFERENCE,
    type: 'debit',
    status: 'pending',
    channel: 'transfer',
    amountKobo: request.amountKobo,
    description: request.narration || `Transfer to ${request.recipient.accountName}`,
    counterparty: {
      name: request.recipient.accountName,
      bankName: bankByCode(request.recipient.bankCode)?.name ?? 'Bank',
      accountNumberLast4: request.recipient.accountNumber.slice(-4),
    },
    createdAt: now.toISOString(),
    idempotencyKey,
    failureReason: null,
  }
}

/** Whether a transaction belongs in a page fetched with these filters. Mirrors the server's filtering. */
export function matchesFilters(transaction: Transaction, filters: TransactionFilters): boolean {
  const day = calendarDate(new Date(transaction.createdAt))
  return (
    (filters.status === undefined || filters.status === transaction.status) &&
    (filters.type === undefined || filters.type === transaction.type) &&
    (filters.from === undefined || day >= filters.from) &&
    (filters.to === undefined || day <= filters.to)
  )
}
