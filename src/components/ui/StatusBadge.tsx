import type { TransactionStatus } from '../../api/contracts'
import { Icon, type IconName } from './Icon'

const STATUS: Record<TransactionStatus, { label: string; icon: IconName; className: string }> = {
  successful: { label: 'Successful', icon: 'check-circle', className: 'bg-success-subtle text-credit' },
  pending: { label: 'Pending', icon: 'clock', className: 'bg-pending-subtle text-pending' },
  failed: { label: 'Failed', icon: 'x-circle', className: 'bg-danger-subtle text-danger' },
}

/** Status in words, with an icon and colour as reinforcement — never colour alone (ADR-0010). */
export function StatusBadge({ status }: { status: TransactionStatus }) {
  const { label, icon, className } = STATUS[status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>
      <Icon name={icon} className="size-3.5" />
      {label}
    </span>
  )
}

