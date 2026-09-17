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
import type { ThunkDispatch, UnknownAction } from '@reduxjs/toolkit'
import { createApi } from '@reduxjs/toolkit/query/react'
import type { z } from 'zod'
import {
  API,
  AccountLookupSchema,
  BalanceSchema,
  BeneficiariesSchema,
  IDEMPOTENCY_HEADER,
  TransactionsPageSchema,
  TransferResponseSchema,
  type AccountLookup,
  type AccountLookupQuery,
  type Balance,
  type Beneficiaries,
  type SendMoneyRequest,
  type TransactionQuery,
  type TransactionsPage,
  type Transaction,
  type TransferResponse,
} from './contracts'
import { novabizBaseQuery } from './baseQuery'
import { matchesFilters, optimisticTransaction } from './optimisticTransfer'
import { isDefiniteFailure } from '../lib/errors'
import { subtractKobo } from '../lib/money'

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
  // ADR-0003: a merchant switching apps should not lose their place; reconnecting should refresh. While a transfer's
  // outcome is open, the reconnect refetch is held back so it cannot overwrite the kept optimistic change — see
  // src/store/reconnectGuard.ts.
  refetchOnFocus: false,
  refetchOnReconnect: true,
  tagTypes: ['Beneficiaries'],
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

    /**
     * Name enquiry (ADR-0018): the holder of an account, from the recipient's bank. The merchant never types a name.
     * Cached for a few minutes per account, so going back and forward does not ask again.
     */
    lookupAccount: build.query<AccountLookup, AccountLookupQuery>({
      query: (params) => ({ url: API.accountLookup, params }),
      transformResponse: parseWith(AccountLookupSchema),
      keepUnusedDataFor: 300,
    }),

    /** People the merchant has paid before, newest first. Refreshed after a transfer is accepted. */
    getBeneficiaries: build.query<Beneficiaries, void>({
      query: () => API.beneficiaries,
      transformResponse: parseWith(BeneficiariesSchema),
      providesTags: ['Beneficiaries'],
      keepUnusedDataFor: 300,
    }),

    sendMoney: build.mutation<TransferResponse, SendMoneyArgs>({
      query: ({ request, idempotencyKey }) => ({
        url: API.transfers,
        method: 'POST',
        headers: { [IDEMPOTENCY_HEADER]: idempotencyKey },
        body: request,
      }),
      transformResponse: parseWith(TransferResponseSchema),
      /**
       * The optimistic update (ADR-0006). The balance drops and a pending row appears before the server answers.
       * What happens to both afterwards depends on what the answer proves:
       *   - accepted:          keep them; swap in the server's row;
       *   - definite failure:  the server promised nothing was sent (or the request never left) — undo them;
       *   - anything else:     we do not know whether money moved — keep them.
       * A bare `catch { undo() }` would restore the balance after a timeout on a transfer that went through.
       *
       * Only the cache is touched here. The Send Money draft's record of the attempt belongs to `sendTransfer`
       * (src/store/sendTransfer.ts), so another caller of this endpoint cannot move the wizard.
       */
      async onQueryStarted({ request, idempotencyKey }, { dispatch, getState, queryFulfilled }) {
        const optimistic = optimisticTransaction(request, idempotencyKey, new Date())
        const fulfilledAt = (select: (state: ApiState) => { fulfilledTimeStamp?: number | undefined }) => select(getState()).fulfilledTimeStamp

        const patches = [
          {
            patch: dispatch(novabizApi.util.updateQueryData('getBalance', undefined, (balance) => {
              balance.availableBalanceKobo = subtractKobo(balance.availableBalanceKobo, request.amountKobo)
            })),
            select: novabizApi.endpoints.getBalance.select(),
          },
          ...novabizApi.util.selectCachedArgsForQuery(getState(), 'getTransactionsPage')
            // Newest first, so a new transfer belongs only at the top of a first page whose filters it matches.
            .filter((args) => args.cursor === null && matchesFilters(optimistic, args.filters))
            .map((args) => ({
              patch: dispatch(novabizApi.util.updateQueryData('getTransactionsPage', args, (page) => {
                page.items.unshift(optimistic)
                page.totalCount += 1
              })),
              select: novabizApi.endpoints.getTransactionsPage.select(args),
            })),
        ].map((entry) => ({ ...entry, patchedOver: fulfilledAt(entry.select) }))

        try {
          const { data } = await queryFulfilled
          applyTransferToCache(dispatch, getState, data.transfer)
        } catch (rejection) {
          if (!isDefiniteFailure((rejection as { error?: unknown }).error)) return
          for (const { patch, select, patchedOver } of patches) {
            // An undo replays reverse patches onto whatever the cache holds now. If the entry was refetched while the
            // request was in flight, it already holds the server's copy — which never included this refused transfer —
            // and replaying would corrupt it: an old balance written back, a page's last row dropped. Leave it.
            if (fulfilledAt(select) === patchedOver) patch.undo()
          }
        }
      },
      // A small list, and the transfer just made changes its order: refetch it. Only on acceptance.
      invalidatesTags: (result) => (result ? ['Beneficiaries'] : []),
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

type ApiState = { [novabizApi.reducerPath]: ReturnType<typeof novabizApi.reducer> }

/**
 * Write the server's current version of a transfer into every cached page that shows it, matched by idempotency
 * key: replaces the optimistic row once the server answers, and updates the status once it settles. A page whose
 * filters the new version no longer matches — a "pending" page, once the transfer succeeds — loses the row.
 */
export function applyTransferToCache(
  dispatch: ThunkDispatch<ApiState, unknown, UnknownAction>,
  getState: () => ApiState,
  transfer: Transaction,
) {
  const key = transfer.idempotencyKey
  if (key === null) return
  for (const args of novabizApi.util.selectCachedArgsForQuery(getState(), 'getTransactionsPage')) {
    dispatch(novabizApi.util.updateQueryData('getTransactionsPage', args, (page) => {
      const index = page.items.findIndex((item) => item.idempotencyKey === key)
      if (index === -1) return
      if (matchesFilters(transfer, args.filters)) {
        page.items[index] = transfer
      } else {
        page.items.splice(index, 1)
        page.totalCount = Math.max(0, page.totalCount - 1)
      }
    }))
  }
}

export const {
  useGetBalanceQuery,
  useGetTransactionsPageQuery,
  useSendMoneyMutation,
  useLazyGetTransferByKeyQuery,
  useLookupAccountQuery,
  useGetBeneficiariesQuery,
} = novabizApi
