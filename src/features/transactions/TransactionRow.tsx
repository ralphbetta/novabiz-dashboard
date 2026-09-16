import type { CSSProperties } from 'react'
import type { Channel, Transaction } from '../../api/contracts'
import { formatSignedNaira } from '../../lib/money'
import { formatTransactionTime } from '../../lib/format'
import { Icon } from '../../components/ui/Icon'
import { StatusBadge } from '../../components/ui/StatusBadge'

const CHANNEL_LABEL: Record<Channel, string> = {
  transfer: 'Bank transfer',
  qr: 'QR payment',
  pos: 'POS payment',
  ussd: 'USSD payment',
}

/**
 * One transaction, as a row of the feed's table (ADR-0008).
 *
 * All five cells exist at every width so the table semantics never change. On narrow screens, Reference, Date and
 * Status are visually hidden but still read by screen readers, and visual duplicates in other cells are aria-hidden,
 * so nothing is announced twice. Text arrives sanitised from the contract (ADR-0013) and renders as plain text.
 */
export function TransactionRow({
  transaction: t,
  rowIndex,
  now,
  style,
}: {
  transaction: Transaction
  rowIndex: number
  now: Date
  /** Position and height from the virtualizer. Omitted for a short, non-virtualised list, which flows normally. */
  style?: CSSProperties
}) {
  const isCredit = t.type === 'credit'
  const when = formatTransactionTime(new Date(t.createdAt), now)
  const description = t.description || CHANNEL_LABEL[t.channel]
  const amountTone = t.status === 'failed' ? 'text-fg-muted' : isCredit ? 'text-credit' : 'text-debit'

  return (
    <div
      role="row"
      aria-rowindex={rowIndex}
      style={style}
      className={`${style ? 'absolute inset-x-0 top-0' : 'relative h-[72px] sm:h-16'} flex items-center gap-3 border-b border-border px-4 last:border-b-0 sm:gap-4 sm:px-5`}
    >
      <div role="cell" className="flex min-w-0 flex-1 items-center gap-3">
        <span
          aria-hidden="true"
          className={`grid size-10 shrink-0 place-items-center rounded-full ${isCredit ? 'bg-credit-subtle text-credit' : 'bg-surface-muted text-fg-muted'}`}
        >
          <Icon name={isCredit ? 'arrow-down-left' : 'arrow-up-right'} className="size-[1.125rem]" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg">{description}</p>
          <p className="truncate text-xs text-fg-muted">
            {/* Narrow: the time is more useful here than the name, which the description usually repeats. */}
            <span className="sr-only sm:not-sr-only">{t.counterparty.name}</span>
            <span aria-hidden="true" className="sm:hidden">{when}</span>
          </p>
        </div>
      </div>

      <div role="cell" className="sr-only font-mono text-xs text-fg-muted lg:not-sr-only lg:w-48 lg:shrink-0 lg:truncate">
        {t.reference}
      </div>

      <div role="cell" className="sr-only text-sm whitespace-nowrap text-fg-muted sm:not-sr-only sm:w-40 sm:shrink-0">
        {when}
      </div>

      <div role="cell" className="sr-only sm:not-sr-only sm:w-32 sm:shrink-0">
        <span className="sr-only sm:not-sr-only"><StatusBadge status={t.status} /></span>
      </div>

      <div role="cell" className="flex shrink-0 flex-col items-end gap-1 sm:w-40">
        <span className={`text-sm font-semibold tabular-nums ${amountTone}`}>
          <span className="sr-only">{isCredit ? 'Money in' : 'Money out'}, </span>
          {formatSignedNaira(t.amountKobo, t.type)}
        </span>
        {t.status !== 'successful' ? (
          <span aria-hidden="true" className="sm:hidden">
            <StatusBadge status={t.status} />
          </span>
        ) : null}
      </div>
    </div>
  )
}

