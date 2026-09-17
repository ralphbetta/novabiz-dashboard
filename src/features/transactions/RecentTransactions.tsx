import { Link } from 'react-router'
import { useGetTransactionsPageQuery } from '../../api/novabizApi'
import { describeRequestError } from '../../lib/requestErrors'
import { StateMessage } from '../../components/feedback/StateMessage'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Skeleton } from '../../components/ui/Skeleton'
import { TransactionRow } from './TransactionRow'
import { OfflineNote } from '../connection/OfflineNote'

const RECENT_COUNT = 6

/** The latest few transactions on the dashboard, with a link to the full, filterable table. */
export function RecentTransactions() {
  const { currentData, error, isFetching, refetch, fulfilledTimeStamp } = useGetTransactionsPageQuery({ filters: {}, limit: RECENT_COUNT, cursor: null })
  // A transfer just sent is added to the top of this page before the server answers, so keep to the latest few.
  const rows = (currentData?.items ?? []).slice(0, RECENT_COUNT)
  const now = new Date()

  return (
    <section aria-labelledby="recent-heading" className="overflow-hidden rounded-3xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 p-4 sm:p-5">
        <div>
          <h2 id="recent-heading" className="text-lg font-semibold text-fg">Recent transactions</h2>
          <p className="text-sm text-fg-muted">Your latest payments in and out.</p>
          <OfflineNote loadedAt={currentData ? fulfilledTimeStamp : undefined} className="font-medium text-pending" />
        </div>
        <Link
          to="/dashboard/transactions"
          className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-accent hover:bg-surface-muted"
        >
          View all
          <Icon name="chevron-right" className="size-4" />
        </Link>
      </div>

      {!currentData && error && !isFetching ? (
        <StateMessage icon="alert" tone="danger" title={describeRequestError(error, 'transactions').title} action={<Button onClick={() => void refetch()}>Try again</Button>}>
          {describeRequestError(error, 'transactions').detail}
        </StateMessage>
      ) : !currentData ? (
        <div className="border-t border-border">
          <p className="sr-only" role="status">Loading recent transactions</p>
          {Array.from({ length: RECENT_COUNT }, (_, i) => (
            <div key={i} aria-hidden="true" className="flex h-[72px] items-center gap-3 border-b border-border px-4 last:border-b-0 sm:h-16 sm:px-5">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-3/5 max-w-72" /><Skeleton className="h-3 w-2/5 max-w-48" /></div>
              <Skeleton className="h-3.5 w-20" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <StateMessage icon="inbox" title="No transactions yet">Payments you receive by QR, POS, USSD or bank transfer will appear here.</StateMessage>
      ) : (
        <div role="table" aria-label="Recent transactions" aria-rowcount={rows.length} className="border-t border-border">
          <div role="rowgroup">
            {rows.map((transaction, index) => (
              <TransactionRow key={transaction.id} transaction={transaction} rowIndex={index + 1} now={now} />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
