import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { bankByCode } from '../../api/banks'
import { useGetBalanceQuery } from '../../api/novabizApi'
import { NARRATION_MAX_LENGTH } from '../../api/contracts'
import { useAnnounce } from '../../components/feedback/announcerContext'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { TextField } from '../../components/ui/TextField'
import { formatAmount, formatNaira, parseNairaInput, toKobo } from '../../lib/money'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { transferDraft } from '../../store/transferDraftSlice'
import { applyAmountEdit } from './amountInput'
import { problemMessage } from './problemMessage'
import { amountSchema, type AmountFormValues } from './schemas'
import { StepActions, StepFrame, StepHeading } from './StepLayout'
import { TransferSummary } from './TransferSummary'

/** One-tap amounts, in kobo. */
const QUICK_AMOUNTS = [100_000, 500_000, 1_000_000, 5_000_000].map(toKobo)

/**
 * Step 2: how much. The amount is a text field with a decimal keypad, never `type="number"` — that gives Android an
 * inconsistent keypad, accepts `1e5`, and changes with the scroll wheel (ADR-0009). It is parsed to whole kobo; no
 * float is ever created (ADR-0002).
 */
export function AmountStep() {
  const dispatch = useAppDispatch()
  const announce = useAnnounce()
  const amountInput = useAppSelector((s) => s.transferDraft.amountInput)
  const narration = useAppSelector((s) => s.transferDraft.narration)
  const recipient = useAppSelector((s) => s.transferDraft.recipient)
  const { data: balance, isLoading: balanceLoading } = useGetBalanceQuery()
  const available = balance?.availableBalanceKobo

  const { register, control, handleSubmit, getValues, setValue, setError, clearErrors, getFieldState, formState: { errors } } = useForm<AmountFormValues, unknown, z.output<ReturnType<typeof amountSchema>>>({
    resolver: zodResolver(amountSchema(available)),
    defaultValues: { amount: amountInput, narration },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  })

  // Keep the draft in step with the form, so the summary shows the amount and the balance after it as it is typed.
  const amountNow = useWatch({ control, name: 'amount' })
  const narrationNow = useWatch({ control, name: 'narration' })
  useEffect(() => {
    dispatch(transferDraft.amountEdited({ amountInput: amountNow, narration: narrationNow }))
  }, [dispatch, amountNow, narrationNow])

  const typedKobo = parseNairaInput(amountNow)
  const amountField = register('amount', {
    // Complete a valid amount when leaving the field: "5,000.5" becomes "5,000.50".
    onBlur: (event: { target: { value: string } }) => {
      const kobo = parseNairaInput(event.target.value)
      if (kobo !== null && kobo > 0) setValue('amount', formatAmount(kobo))
    },
  })
  const bank = bankByCode(recipient.bankCode)

  return (
    <StepFrame step="amount" aside={<TransferSummary />}>
      <form
        noValidate
        onSubmit={handleSubmit(
          () => dispatch(transferDraft.amountSaved({ amountInput: getValues('amount'), narration: getValues('narration') })),
          (invalid) => announce(problemMessage(invalid), 'assertive'),
        )}
      >
        <StepHeading
          description={
            <span className="inline-flex items-center gap-2">
              <Avatar name={recipient.accountName} size="sm" />
              <span>
                To <span className="font-semibold text-fg">{recipient.accountName}</span> · {bank?.shortName} ••••{recipient.accountNumber.slice(-4)}
              </span>
            </span>
          }
        >
          How much are you sending?
        </StepHeading>

        <TextField
          label="Amount in naira"
          size="lg"
          adornment="₦"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          error={errors.amount?.message}
          hint={
            balanceLoading ? 'Checking your available balance…'
              : available === undefined ? 'Your available balance could not be loaded. The bank will still check it.'
                : <>Available balance: <span className="font-semibold text-fg tabular-nums">{formatNaira(available)}</span></>
          }
          {...amountField}
          onKeyDown={(event) => {
            // Delete just before a comma: step over it so the digit after it goes. (Backspace beside a comma is handled
            // in applyAmountEdit, because Android keyboards often report every key as "Unidentified".)
            const input = event.currentTarget
            const at = input.selectionStart
            if (event.key === 'Delete' && at !== null && at === input.selectionEnd && input.value.charAt(at) === ',') {
              input.setSelectionRange(at + 1, at + 1)
            }
          }}
          onChange={(event) => {
            // Grouped as it is typed; an edit that could mean a different amount is refused, not reinterpreted
            // (amountInput.ts).
            const input = event.target
            const { value, caret, problem } = applyAmountEdit(getValues('amount'), input.value, input.selectionStart ?? input.value.length)
            input.value = value
            input.setSelectionRange(caret, caret)
            if (problem) {
              setError('amount', { type: 'input', message: problem })
              announce(problem, 'assertive')
            } else if (getFieldState('amount').error?.type === 'input') {
              clearErrors('amount')
            }
            return amountField.onChange(event)
          }}
        />

        <div role="group" aria-label="Quick amounts" className="mt-3 grid grid-cols-4 gap-2">
          {QUICK_AMOUNTS.map((kobo) => (
            <button
              key={kobo}
              type="button"
              aria-pressed={typedKobo === kobo}
              onClick={() => setValue('amount', formatAmount(kobo), { shouldValidate: true, shouldDirty: true })}
              className={`min-h-11 rounded-xl border px-1 text-sm font-semibold tabular-nums transition ${
                typedKobo === kobo ? 'border-accent bg-surface-muted text-accent' : 'border-border text-fg hover:border-border-strong hover:bg-surface-muted'
              }`}
            >
              {formatNaira(kobo).replace('.00', '')}
            </button>
          ))}
        </div>

        <TextField
          className="mt-5"
          label="Description (optional)"
          autoComplete="off"
          maxLength={NARRATION_MAX_LENGTH}
          placeholder="What is this payment for?"
          error={errors.narration?.message}
          {...register('narration')}
        />

        <StepActions>
          <Button onClick={() => dispatch(transferDraft.stepChanged('recipient'))} className="w-full sm:w-auto">
            <Icon name="chevron-left" className="size-4" />
            Back
          </Button>
          <Button type="submit" variant="primary" className="w-full sm:w-auto sm:min-w-40">
            Continue
            <Icon name="chevron-right" className="size-4" />
          </Button>
        </StepActions>
      </form>
    </StepFrame>
  )
}
