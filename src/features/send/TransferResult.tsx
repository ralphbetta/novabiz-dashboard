import { useEffect, useRef, type ReactNode } from 'react'
import { bankByCode } from '../../api/banks'
import { useAnnounce } from '../../components/feedback/announcerContext'
import { Avatar } from '../../components/ui/Avatar'
import { Button, ButtonLink } from '../../components/ui/Button'
import { Icon, type IconName } from '../../components/ui/Icon'
import { formatNaira } from '../../lib/money'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { retryTransfer } from '../../store/sendTransfer'
import { transferDraft, type TransferAttempt } from '../../store/transferDraftSlice'
import { StepHeading } from './StepLayout'

interface Outcome {
  icon: IconName
  tone: 'progress' | 'success' | 'danger' | 'warning'
  label: string
  title: string
  body: ReactNode
  announcement: string
  politeness: 'polite' | 'assertive'
  spinning?: boolean
}

function describe(attempt: TransferAttempt): Outcome {
  const amount = attempt.request ? formatNaira(attempt.request.amountKobo) : null
  const name = attempt.request?.recipient.accountName ?? null
  switch (attempt.status) {
    case 'sending':
      return {
        icon: 'refresh', tone: 'progress', label: 'Sending', title: 'Sending your transfer…', spinning: true,
        body: 'You can leave this page. The transfer will carry on.',
        announcement: 'Sending your transfer', politeness: 'polite',
      }
    case 'pending':
      return attempt.trackingStopped
        ? {
            icon: 'clock', tone: 'warning', label: 'Still processing', title: 'This is taking longer than usual',
            body: 'The bank has your transfer but has not confirmed it yet. Check your transactions later; please don’t send it again.',
            announcement: 'The transfer is taking longer than usual. Please don’t send it again.', politeness: 'polite',
          }
        : {
            icon: 'clock', tone: 'progress', label: 'Processing', title: 'Transfer on its way',
            body: 'The bank has received it and is completing it. This usually takes a few seconds.',
            announcement: amount ? `Transfer of ${amount} received by the bank and on its way` : 'Transfer received by the bank and on its way',
            politeness: 'polite',
          }
    case 'successful':
      return {
        icon: 'check-circle', tone: 'success', label: 'Successful', title: 'Transfer successful',
        body: name ? <>The bank has confirmed this transfer to {name}.</> : 'The bank has confirmed this transfer.',
        announcement: amount && name ? `Transfer successful. ${amount} sent to ${name}` : 'Transfer successful', politeness: 'polite',
      }
    case 'failed':
      return attempt.failure?.afterAcceptance
        ? {
            icon: 'x-circle', tone: 'danger', label: 'Failed', title: 'Transfer failed',
            body: <>{sentence(attempt.failure.message)} The money has been returned to your balance.</>,
            announcement: `Transfer failed. ${sentence(attempt.failure.message)} The money has been returned to your balance.`, politeness: 'assertive',
          }
        : {
            icon: 'x-circle', tone: 'danger', label: 'Not sent', title: 'Transfer not sent',
            body: attempt.failure?.message ?? 'The transfer could not be started. Nothing was sent.',
            announcement: `Transfer not sent. ${attempt.failure?.message ?? 'Nothing was sent.'}`, politeness: 'assertive',
          }
    case 'unknown':
      if (attempt.needsAttention) {
        return {
          icon: 'alert', tone: 'warning', label: 'Needs attention', title: 'We still can’t confirm this transfer',
          body: (
            <>
              The bank hasn&rsquo;t given a clear answer, so the money <strong>may already have been sent</strong>. Check its
              status again{attempt.request ? <>, or try again — trying again uses the same reference, so it cannot pay twice</> : null}.
            </>
          ),
          announcement: 'We still can’t confirm this transfer. The money may already have been sent. Check its status before sending again.',
          politeness: 'assertive',
        }
      }
      return {
        icon: 'refresh', tone: 'warning', label: 'Checking', title: 'We’re confirming this transfer', spinning: true,
        body: (
          <>
            {attempt.request ? 'We didn’t get a clear answer from the bank' : 'A transfer from before the page reloaded wasn’t confirmed'}, so
            the money <strong>may already have been sent</strong>. We&rsquo;re checking with the bank now. Please don&rsquo;t
            send it again.
          </>
        ),
        announcement: `We couldn't confirm this transfer yet. We're checking with the bank. The money may already have been sent. Please don't send it again.`,
        politeness: 'assertive',
      }
  }
}

/** What the screen is showing. Announcements follow changes to this, not only to the status. */
function outcomeKey(attempt: TransferAttempt | null): string | undefined {
  return attempt ? `${attempt.status}:${attempt.trackingStopped}:${attempt.needsAttention}` : undefined
}

/** A message as one sentence ending in exactly one full stop, whatever the source put at its end. */
function sentence(message: string): string {
  return `${message.trim().replace(/[.\s]+$/, '')}.`
}

const TONE: Record<Outcome['tone'], string> = {
  progress: 'bg-surface-muted text-fg',
  success: 'bg-credit-subtle text-credit',
  danger: 'bg-danger-subtle text-danger',
  warning: 'bg-pending-subtle text-pending',
}

/**
 * The outcome of the current attempt, as a receipt, in words that are true (ADR-0006). "Not sent" appears only when
 * the server promised nothing moved; an unknown outcome says the money may have gone, is checked with the bank, and
 * asks the merchant not to send it again.
 */
export function TransferResult() {
  const dispatch = useAppDispatch()
  const announce = useAnnounce()
  const attempt = useAppSelector((s) => s.transferDraft.attempt)

  // Announce changes while this screen is open, not the outcome found on arriving here: the heading already says it.
  const announced = useRef<string | undefined>(outcomeKey(attempt))
  useEffect(() => {
    const key = outcomeKey(attempt)
    if (!attempt || announced.current === key) return
    announced.current = key
    const { announcement, politeness } = describe(attempt)
    announce(announcement, politeness)
  }, [attempt, announce])

  if (!attempt) return null
  const outcome = describe(attempt)
  const { request } = attempt
  const bank = request ? bankByCode(request.recipient.bankCode) : undefined
  const unknown = attempt.status === 'unknown'

  return (
    <div aria-busy={attempt.status === 'sending'} className="mx-auto max-w-xl">
      <div className="overflow-hidden rounded-3xl border border-border bg-surface">
        <div className="flex flex-col items-center px-6 pt-10 pb-8 text-center">
          <span aria-hidden="true" className={`grid size-20 place-items-center rounded-full ${TONE[outcome.tone]}`}>
            <Icon name={outcome.icon} className={`size-10 ${outcome.spinning ? 'animate-spin' : ''}`} />
          </span>
          <div className="mt-5">
            <StepHeading>{outcome.title}</StepHeading>
          </div>
          {request ? <p className="-mt-4 text-4xl font-semibold tracking-tight text-fg tabular-nums">{formatNaira(request.amountKobo)}</p> : null}
          <p className={`max-w-md text-sm text-fg-muted ${request ? 'mt-3' : '-mt-2'}`}>{outcome.body}</p>
        </div>

        <dl className="divide-y divide-border border-t border-border text-sm">
          {request ? (
            <Detail label="Recipient">
              <span className="inline-flex items-center gap-2">
                <Avatar name={request.recipient.accountName} size="sm" />
                <span className="text-left">
                  <span className="block font-semibold text-fg">{request.recipient.accountName}</span>
                  <span className="block text-xs text-fg-muted">{bank?.name ?? 'Bank'} · ••••{request.recipient.accountNumber.slice(-4)}</span>
                </span>
              </span>
            </Detail>
          ) : null}
          <Detail label="Status">
            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[outcome.tone]}`}>{outcome.label}</span>
          </Detail>
          {attempt.reference ? <Detail label="Reference"><span className="font-medium tabular-nums">{attempt.reference}</span></Detail> : null}
          {request?.narration ? <Detail label="Description">{request.narration}</Detail> : null}
        </dl>
      </div>

      <div className="mt-6 flex flex-col-reverse flex-wrap gap-3 sm:flex-row sm:justify-center">
        {attempt.status === 'sending' ? null : <ButtonLink to="/dashboard/transactions">View transactions</ButtonLink>}
        {attempt.status === 'failed' && !attempt.failure?.afterAcceptance && request ? (
          <Button variant="primary" onClick={() => dispatch(transferDraft.editAfterFailure())}>Edit transfer</Button>
        ) : null}
        {attempt.status === 'pending' || attempt.status === 'successful' || attempt.status === 'failed' ? (
          <Button variant={attempt.status === 'failed' && !attempt.failure?.afterAcceptance && request ? 'secondary' : 'primary'} onClick={() => dispatch(transferDraft.draftReset())}>
            Send another transfer
          </Button>
        ) : null}
        {unknown ? <Button onClick={() => dispatch(transferDraft.draftReset())}>Start a different transfer</Button> : null}
        {unknown && attempt.needsAttention && request ? (
          <Button onClick={() => void dispatch(retryTransfer())}>Try again</Button>
        ) : null}
        {unknown && attempt.needsAttention ? (
          <Button variant="primary" onClick={() => dispatch(transferDraft.reconciliationRestarted({ idempotencyKey: attempt.idempotencyKey }))}>
            <Icon name="refresh" className="size-4" />
            Check status
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-4">
      <dt className="shrink-0 text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-right break-words text-fg">{children}</dd>
    </div>
  )
}
