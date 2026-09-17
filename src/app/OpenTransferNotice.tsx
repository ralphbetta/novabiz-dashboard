import { Link, useLocation } from 'react-router'
import { Icon } from '../components/ui/Icon'
import { useAppSelector } from '../store/hooks'

const SEND_MONEY_PATH = '/dashboard/send-money'

/**
 * A notice on every other page while a transfer's outcome is unknown (ADR-0006). The merchant may leave the Send Money
 * page before reconciliation finishes; wherever they go, they are told not to send the money again, and where to look.
 * The Send Money page shows the full receipt instead.
 */
export function OpenTransferNotice() {
  const { pathname } = useLocation()
  const status = useAppSelector((s) => s.transferDraft.attempt?.status)
  const needsAttention = useAppSelector((s) => s.transferDraft.attempt?.needsAttention ?? false)
  if (status !== 'unknown' || pathname === SEND_MONEY_PATH) return null

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-pending-subtle px-4 py-3 text-sm text-pending">
      <Icon name="alert" className="size-5" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">
          {needsAttention ? 'We still can’t confirm a transfer.' : 'We’re confirming a transfer.'}
        </span>{' '}
        The money may already have been sent. Please don&rsquo;t send it again.
      </p>
      <Link to={SEND_MONEY_PATH} className="inline-flex min-h-11 items-center font-semibold underline">
        {needsAttention ? 'Check it' : 'View'}
      </Link>
    </div>
  )
}
