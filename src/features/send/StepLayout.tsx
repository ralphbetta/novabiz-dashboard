import type { ReactNode } from 'react'
import { Icon } from '../../components/ui/Icon'
import type { WizardStep } from '../../store/transferDraftSlice'

type FormStep = Exclude<WizardStep, 'result'>

const STEPS: { step: FormStep; label: string }[] = [
  { step: 'recipient', label: 'Recipient' },
  { step: 'amount', label: 'Amount' },
  { step: 'review', label: 'Review' },
]

/**
 * A step's frame: the card holding the form, with a slim progress row on top, and an optional side panel beside it
 * on wide screens. Built so the step's main action is on screen without scrolling at common laptop sizes.
 */
export function StepFrame({ step, aside, children }: { step: FormStep; aside?: ReactNode; children: ReactNode }) {
  const card = (
    <div className="min-w-0 rounded-3xl border border-border bg-surface">
      <div className="border-b border-border px-5 py-3.5 sm:px-8">
        <StepProgress current={step} />
      </div>
      <div className="px-5 pt-6 sm:px-8 sm:pb-8">{children}</div>
    </div>
  )
  if (!aside) return <div className="mx-auto max-w-2xl">{card}</div>
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
      {card}
      <div className="hidden lg:sticky lg:top-24 lg:block">{aside}</div>
    </div>
  )
}

/** Where the merchant is: numbered steps in one row. The current step carries `aria-current="step"` (ADR-0009). */
function StepProgress({ current }: { current: FormStep }) {
  const currentIndex = STEPS.findIndex((s) => s.step === current)
  return (
    <ol aria-label="Transfer steps" className="flex items-center gap-2 sm:gap-3">
      {STEPS.map(({ step, label }, index) => {
        const done = index < currentIndex
        const active = index === currentIndex
        return (
          <li key={step} aria-current={active ? 'step' : undefined} className="flex items-center gap-2 sm:gap-3">
            {index > 0 ? <span aria-hidden="true" className={`h-px w-4 sm:w-8 ${done || active ? 'bg-accent' : 'bg-border'}`} /> : null}
            <span
              aria-hidden="true"
              className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                active ? 'bg-accent text-accent-fg' : done ? 'bg-credit-subtle text-credit' : 'bg-surface-muted text-fg-muted'
              }`}
            >
              {done ? <Icon name="check" className="size-3.5" /> : index + 1}
            </span>
            {/* On phones only the current step is named, so the row fits at 360px. */}
            <span className={`text-sm ${active ? 'font-semibold text-fg' : 'hidden text-fg-muted sm:inline'}`}>
              {label}
              {done ? <span className="sr-only"> (done)</span> : null}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * A step's heading. The wizard moves focus here on every step change, so a screen reader announces the new step
 * rather than leaving focus on a button that no longer exists (ADR-0009).
 */
export function StepHeading({ children, description }: { children: ReactNode; description?: ReactNode }) {
  return (
    <div className="mb-5">
      <h2 data-step-heading tabIndex={-1} className="text-xl font-semibold tracking-tight text-fg focus:outline-none">
        {children}
      </h2>
      {description ? <div className="mt-1 text-sm text-fg-muted">{description}</div> : null}
    </div>
  )
}

/**
 * The step's buttons. On phones they stick to the bottom of the screen, so the next action never needs a scroll; from
 * 640px they sit at the end of the form.
 */
export function StepActions({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 -mx-5 mt-6 flex flex-col-reverse gap-3 rounded-b-3xl border-t border-border bg-surface px-5 py-4 sm:static sm:mx-0 sm:mt-8 sm:flex-row sm:justify-between sm:border-0 sm:p-0">
      {children}
    </div>
  )
}
