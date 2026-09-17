import { useEffect, useRef } from 'react'
import { useAppSelector } from '../../store/hooks'
import { AmountStep } from './AmountStep'
import { RecipientStep } from './RecipientStep'
import { ReviewStep } from './ReviewStep'
import { TransferResult } from './TransferResult'

/**
 * Send Money: recipient → amount → review → result (ADR-0009). Each step lays itself out (StepFrame), with a side
 * panel where one helps: recent recipients on step 1, a live summary on step 2.
 *
 * The step and every value live in the store (ADR-0004), so leaving the page and coming back resumes where the
 * merchant was, and a transfer in flight keeps going. On each step change, focus moves to the new step's heading.
 */
export function SendMoneyWizard() {
  const step = useAppSelector((s) => s.transferDraft.step)
  const container = useRef<HTMLDivElement>(null)
  const previousStep = useRef(step)

  useEffect(() => {
    // Not on arrival: the page heading takes focus then (RouteFocus).
    if (previousStep.current !== step) container.current?.querySelector<HTMLElement>('[data-step-heading]')?.focus()
    previousStep.current = step
  }, [step])

  return (
    <div ref={container}>
      {step === 'recipient' ? <RecipientStep /> : null}
      {step === 'amount' ? <AmountStep /> : null}
      {step === 'review' ? <ReviewStep /> : null}
      {step === 'result' ? <TransferResult /> : null}
    </div>
  )
}
