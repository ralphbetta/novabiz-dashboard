import type { ReactNode } from 'react'
import { bankByCode } from '../../api/banks'
import { useGetBalanceQuery } from '../../api/novabizApi'
import { MERCHANT } from '../../app/merchant'
import { useAnnounce } from '../../components/feedback/announcerContext'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { formatNaira, subtractKobo } from '../../lib/money'
import { sanitizeText } from '../../lib/sanitize'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { sendTransfer } from '../../store/sendTransfer'
import { transferDraft } from '../../store/transferDraftSlice'
import { selectOnline } from '../../store/connectivitySlice'
import { buildRequest } from './schemas'
import { StepActions, StepFrame, StepHeading } from './StepLayout'

/**
 * Step 3: check, then send. Shows the exact amount, the verified name and the full account number — the one place the
 * full number appears (ADR-0015) — because this is the last chance to catch a wrong digit.
 *
 * Every rule runs again here (ADR-0009): the balance may have changed since step 2.
 */
export function ReviewStep() {
  const dispatch = useAppDispatch()
  const announce = useAnnounce()
  const recipient = useAppSelector((s) => s.transferDraft.recipient)
  const amountInput = useAppSelector((s) => s.transferDraft.amountInput)
  const narration = useAppSelector((s) => s.transferDraft.narration)
  const { data: balance } = useGetBalanceQuery()
  const online = useAppSelector(selectOnline)

  const built = buildRequest({ recipient, amountInput, narration }, balance?.availableBalanceKobo)
  const bank = bankByCode(recipient.bankCode)
  const after = built.ok && balance ? subtractKobo(balance.availableBalanceKobo, built.request.amountKobo) : null

  // A second tap sends nothing: `sendTransfer` refuses while an attempt's outcome is open. It creates the attempt's
  // idempotency key, once (ADR-0007).
  const send = () => {
    // Offline: nothing is queued to go out later on its own (ADR-0014). The details stay for when the connection is back.
    if (!online) {
      announce('You’re offline. Your transfer will be ready to send when you’re back online.', 'assertive')
      return
    }
    if (!built.ok) {
      announce(`There is a problem: ${built.message}`, 'assertive')
      return
    }
    void dispatch(sendTransfer({ request: built.request }))
  }
  // Show exactly what will be sent: the description as the request carries it, sanitised (ADR-0013). The draft holds
  // what was typed, which can include direction overrides and invisible characters. While review is blocked there is
  // no request, so show the typed description, sanitised the same way, rather than "None".
  const description = built.ok ? built.request.narration : sanitizeText(narration) || undefined

  return (
    <StepFrame step="review">
      <StepHeading>Review and send</StepHeading>

      {!built.ok ? (
        <div className="mb-4 flex items-start gap-3 rounded-2xl bg-danger-subtle p-4 text-sm text-danger">
          <Icon name="alert" className="mt-0.5 size-5" />
          <div>
            <p className="font-semibold">{built.message}</p>
            <button type="button" onClick={() => dispatch(transferDraft.stepChanged(built.step))} className="min-h-11 font-semibold underline">
              Fix this
            </button>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-border">
        <div className="flex items-center gap-3 p-4">
          <Avatar name={recipient.accountName || '?'} />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold break-words text-fg">{recipient.accountName}</p>
            {/* Never truncated: the full account number is what this step exists to show (ADR-0015). */}
            <p className="text-sm text-fg-muted">
              {bank?.name ?? 'Unknown bank'}
              <span className="hidden sm:inline"> · </span>
              <span className="block font-semibold tracking-wide text-fg tabular-nums sm:inline">{recipient.accountNumber}</span>
            </p>
          </div>
          <EditButton label="Change recipient" onClick={() => dispatch(transferDraft.stepChanged('recipient'))} />
        </div>

        <div className="flex items-center gap-3 border-t border-border p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-fg-muted">Amount</p>
            <p className="text-3xl font-semibold tracking-tight text-fg tabular-nums">
              {built.ok ? formatNaira(built.request.amountKobo) : amountInput || '—'}
            </p>
          </div>
          <EditButton label="Change amount or description" onClick={() => dispatch(transferDraft.stepChanged('amount'))} />
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border p-4 text-sm sm:grid-cols-3">
          <Fact label="Description">{description ? description : <span className="text-fg-muted">None</span>}</Fact>
          <Fact label="From">{MERCHANT.name} ••••{MERCHANT.accountLast4}</Fact>
          <Fact label="Balance after">{after === null ? '—' : formatNaira(after)}</Fact>
        </dl>
      </div>

      <p className="mt-3 flex items-start gap-2 text-xs text-fg-muted">
        <Icon name="alert" className="mt-px size-4" />
        Check the name. A completed transfer cannot be reversed.
      </p>

      <StepActions
        note={online ? null : (
          <p id="send-offline" className="flex items-start gap-2 rounded-xl bg-pending-subtle px-3 py-2.5 text-sm text-pending">
            <Icon name="wifi-off" className="mt-px size-4" />
            <span><span className="font-semibold">You’re offline.</span> Your details are kept. You can send when you’re back online.</span>
          </p>
        )}
      >
        <Button onClick={() => dispatch(transferDraft.stepChanged('amount'))} className="w-full sm:w-auto">
          <Icon name="chevron-left" className="size-4" />
          Back
        </Button>
        {/* aria-disabled, not disabled: it stays focusable, so a keyboard or screen reader user reaches it and hears why. */}
        <Button
          variant="primary"
          onClick={send}
          aria-disabled={!online || undefined}
          aria-describedby={online ? undefined : 'send-offline'}
          className="w-full sm:w-auto sm:min-w-48"
        >
          <Icon name="send" className="size-4" />
          {built.ok ? `Send ${formatNaira(built.request.amountKobo)}` : 'Send money'}
        </Button>
      </StepActions>
    </StepFrame>
  )
}

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="min-h-11 shrink-0 rounded-xl px-3 text-sm font-semibold text-accent hover:bg-surface-muted">
      Edit
    </button>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-0.5 font-medium break-words text-fg tabular-nums">{children}</dd>
    </div>
  )
}
