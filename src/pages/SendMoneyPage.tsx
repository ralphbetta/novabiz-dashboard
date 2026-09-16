import { usePageTitle } from '../app/pageTitle'
import { PageHeader } from '../app/PageHeader'
import { StateMessage } from '../components/feedback/StateMessage'

/** The route exists now; the Send Money form arrives in Phase 5. Said plainly rather than showing a fake form. */
export function SendMoneyPage() {
  usePageTitle('Send money')
  return (
    <>
      <PageHeader title="Send money">
        Pay a supplier or send money to any Nigerian bank account.
      </PageHeader>
      <div className="rounded-3xl border border-border bg-surface">
        <StateMessage icon="send" title="Sending money is coming next">
          This is where you&rsquo;ll pay suppliers and transfer to any bank. It isn&rsquo;t available yet.
        </StateMessage>
      </div>
    </>
  )
}
