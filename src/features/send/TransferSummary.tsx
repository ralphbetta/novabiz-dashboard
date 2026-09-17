import type { ReactNode } from 'react'
import { bankByCode } from '../../api/banks'
import { useGetBalanceQuery } from '../../api/novabizApi'
import { Avatar } from '../../components/ui/Avatar'
import { Icon } from '../../components/ui/Icon'
import { formatNaira, parseNairaInput, subtractKobo } from '../../lib/money'
import { useAppSelector } from '../../store/hooks'

/**
 * The transfer so far, beside the amount step on wide screens. It fills in as the merchant types: the verified
 * recipient, the amount, and what their balance will be after it. Phones show the recipient in the step heading instead.
 *
 * `aside` with its own heading, so screen-reader users can find it but it does not interrupt the form.
 */
export function TransferSummary() {
  const recipient = useAppSelector((s) => s.transferDraft.recipient)
  const amountInput = useAppSelector((s) => s.transferDraft.amountInput)
  const { data: balance } = useGetBalanceQuery()

  const parsed = parseNairaInput(amountInput)
  const amount = parsed !== null && parsed > 0 ? parsed : null
  const available = balance?.availableBalanceKobo
  const after = available !== undefined && amount !== null ? subtractKobo(available, amount) : null
  const bank = bankByCode(recipient.bankCode)
  const verified = recipient.accountName !== ''

  return (
    <aside aria-labelledby="transfer-summary-heading" className="rounded-3xl border border-border bg-surface p-6">
      <h2 id="transfer-summary-heading" className="text-xs font-semibold tracking-wide text-fg-muted uppercase">Transfer summary</h2>

      <div className="mt-4">
        {verified ? (
          <div className="flex items-center gap-3">
            <Avatar name={recipient.accountName} />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-base font-semibold text-fg">
                <span className="truncate">{recipient.accountName}</span>
                <Icon name="check-circle" className="size-4 text-credit" />
                <span className="sr-only">(verified)</span>
              </p>
              <p className="truncate text-sm text-fg-muted">{bank?.name} · ••••{recipient.accountNumber.slice(-4)}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="grid size-11 place-items-center rounded-full border border-dashed border-border-strong text-fg-muted">
              <Icon name="send" className="size-4" />
            </span>
            <p className="text-sm text-fg-muted">No recipient yet</p>
          </div>
        )}
      </div>

      <dl className="mt-6 space-y-3 border-t border-border pt-5 text-sm">
        <Row label="Amount">{amount !== null ? <span className="text-lg font-semibold text-fg">{formatNaira(amount)}</span> : '—'}</Row>
        <Row label="Available balance">{available !== undefined ? formatNaira(available) : '—'}</Row>
        <Row label="Balance after">
          {after === null ? '—' : <span className={after < 0 ? 'font-semibold text-danger' : 'font-semibold text-fg'}>{formatNaira(after)}</span>}
        </Row>
      </dl>

      <p className="mt-6 flex items-start gap-2 rounded-2xl bg-surface-muted p-3 text-xs text-fg-muted">
        <Icon name="clock" className="mt-0.5 size-4" />
        Transfers to other Nigerian banks usually arrive within seconds.
      </p>
    </aside>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-right text-fg tabular-nums">{children}</dd>
    </div>
  )
}
