import { usePageTitle } from '../app/pageTitle'
import { PageHeader } from '../app/PageHeader'
import { MERCHANT } from '../app/merchant'
import { BalanceOverview } from '../features/balance/BalanceOverview'
import { RecentTransactions } from '../features/transactions/RecentTransactions'
import { formatLongDate, greeting } from '../lib/format'

export function OverviewPage() {
  usePageTitle('Dashboard')
  const now = new Date()
  return (
    <>
      <PageHeader title={`${greeting(now)}, ${MERCHANT.shortName}`}>
        <span className="md:hidden">{formatLongDate(now)} · </span>
        Here&rsquo;s how your business is doing today.
      </PageHeader>
      <div className="flex flex-col gap-6">
        <BalanceOverview />
        <RecentTransactions />
      </div>
    </>
  )
}
