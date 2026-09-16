/**
 * The RTK Query API slice (ADR-0003): every piece of server-derived state in the app.
 *
 * One instance, bound to the hooks. Timing and the base URL come from the store (see baseQuery.ts), so tests
 * configure this same instance rather than building a separate one the hooks would not be connected to.
 *
 * Responses are validated against the shared contract in `transformResponse`, so components only ever see
 * contract-valid data, with amounts typed as `Kobo`. RTK Query's own `responseSchema` option cannot take the
 * contract schemas: it requires input and output types to match, and they turn a number into `Kobo`.
 */
import { createApi } from '@reduxjs/toolkit/query/react'
import type { z } from 'zod'
import {
  API,
  BalanceSchema,
  IDEMPOTENCY_HEADER,
  TransactionsPageSchema,
  TransferResponseSchema,
  type Balance,
  type SendMoneyRequest,
  type TransactionQuery,
  type TransactionsPage,
  type TransferResponse,
} from './contracts'
import { novabizBaseQuery } from './baseQuery'

/** Server-side feed filters. Each distinct value is its own cache entry (ADR-0008). */
export type TransactionFilters = Pick<TransactionQuery, 'from' | 'to' | 'status' | 'type'>

export interface TransactionsPageArgs {
  filters: TransactionFilters
  /** Rows per page, from the table's rows-per-page option. */
  limit: number
  /** The server's opaque cursor for this page; null for the first page. */
  cursor: string | null
}

export interface SendMoneyArgs {
  /** Already validated by SendMoneyRequestSchema: only a parsed request can be sent. */
  request: SendMoneyRequest
  /** Generated once per attempt and reused on every retry of it (ADR-0007). */
  idempotencyKey: string
}

const parseWith =
  <S extends z.ZodType>(schema: S) =>
  (raw: unknown): z.output<S> =>
    schema.parse(raw)

export const novabizApi = createApi({
  reducerPath: 'novabizApi',
  baseQuery: novabizBaseQuery,
  // ADR-0003: a merchant switching apps should not lose their place; reconnecting should refresh.
  // Before optimistic transfers exist (Phase 6), reconnect must reconcile before refetching — see the plan.
  refetchOnFocus: false,
  refetchOnReconnect: true,
  endpoints: (build) => ({
    getBalance: build.query<Balance, void>({
      query: () => API.balance,
      transformResponse: parseWith(BalanceSchema),
      keepUnusedDataFor: 30,
    }),

    /**
     * One page of the transaction table (ADR-0016). Filters, page size and cursor together are the cache key, so
     * paging back to a page already seen is instant, and each page refetches independently — on reconnect, only
     * the page on screen reloads.
     */
    getTransactionsPage: build.query<TransactionsPage, TransactionsPageArgs>({
      query: ({ filters, limit, cursor }) => ({
        url: API.transactions,
        params: {
          ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined)),
          limit,
          ...(cursor === null ? {} : { cursor }),
        },
      }),
      transformResponse: parseWith(TransactionsPageSchema),
      keepUnusedDataFor: 120,
    }),

    sendMoney: build.mutation<TransferResponse, SendMoneyArgs>({
      query: ({ request, idempotencyKey }) => ({
        url: API.transfers,
        method: 'POST',
        headers: { [IDEMPOTENCY_HEADER]: idempotencyKey },
        body: request,
      }),
      transformResponse: parseWith(TransferResponseSchema),
      // ADR-0014: never retry a transfer. The base query already refuses to retry any mutation; this is a
      // second, explicit guard so the intent is visible here too.
      extraOptions: { maxRetries: 0 },
    }),

    /** The reconciliation lookup (ADR-0006). */
    getTransferByKey: build.query<TransferResponse, string>({
      query: (idempotencyKey) => ({ url: API.transfers, params: { idempotencyKey } }),
      transformResponse: parseWith(TransferResponseSchema),
      // Always ask the server. `keepUnusedDataFor: 0` alone only drops the entry once nothing subscribes to it;
      // while a reconciliation poll is subscribed, a repeat lookup would otherwise return the cached "pending".
      forceRefetch: () => true,
      keepUnusedDataFor: 0,
    }),
  }),
})

export type NovabizApi = typeof novabizApi

export const {
  useGetBalanceQuery,
  useGetTransactionsPageQuery,
  useSendMoneyMutation,
  useLazyGetTransferByKeyQuery,
} = novabizApi
