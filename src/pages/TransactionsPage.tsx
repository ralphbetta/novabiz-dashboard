import { usePageTitle } from '../app/pageTitle'
import { PageHeader } from '../app/PageHeader'
import { TransactionsSection } from '../features/transactions/TransactionsSection'

export function TransactionsPage() {
  usePageTitle('Transactions')
  return (
    <>
      <PageHeader title="Transactions">
        Every payment in and out of your wallet. Filter by date, status or direction.
      </PageHeader>
      <TransactionsSection />
    </>
  )
}
