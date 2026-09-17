import { useEffect, useId, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { skipToken } from '@reduxjs/toolkit/query/react'
import type { z } from 'zod'
import { BANKS, bankByCode } from '../../api/banks'
import type { Beneficiary } from '../../api/contracts'
import { novabizApi, useLookupAccountQuery } from '../../api/novabizApi'
import { useAnnounce } from '../../components/feedback/announcerContext'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Select } from '../../components/ui/Select'
import { FieldError, TextField } from '../../components/ui/TextField'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { transferDraft } from '../../store/transferDraftSlice'
import { problemMessage } from './problemMessage'
import { RecentRecipientsPanel, RecentRecipientsRow } from './RecentRecipients'
import { recipientSchema, type RecipientFormValues } from './schemas'
import { StepActions, StepFrame, StepHeading } from './StepLayout'

const BANK_OPTIONS = [{ value: '', label: 'Select a bank' }, ...BANKS.map((bank) => ({ value: bank.code, label: bank.name }))]

/**
 * Step 1: who the money goes to.
 *
 * The merchant picks someone they have paid before, or enters an account number and bank. The account holder's name
 * is then looked up from the recipient's bank and shown for them to confirm (ADR-0018). They never type a name: a
 * typed name proves nothing, and a wrong digit would send money to a stranger with a believable label.
 */
export function RecipientStep() {
  const dispatch = useAppDispatch()
  const announce = useAnnounce()
  const saved = useAppSelector((s) => s.transferDraft.recipient)
  const bankErrorId = useId()
  // Whether Continue has been pressed for the account now entered. The problem shown is worked out from this and the
  // lookup's current state, so it goes away by itself once the account is verified.
  const [continuePressed, setContinuePressed] = useState(false)
  // Load the balance now, so the amount step can show it — and check against it — the moment it opens.
  const prefetchBalance = novabizApi.usePrefetch('getBalance')
  useEffect(() => { prefetchBalance(undefined) }, [prefetchBalance])

  const { register, control, handleSubmit, setValue, setFocus, setError, clearErrors, getValues, getFieldState, formState: { errors } } = useForm<RecipientFormValues, unknown, z.output<typeof recipientSchema>>({
    resolver: zodResolver(recipientSchema),
    defaultValues: { accountNumber: saved.accountNumber, bankCode: saved.bankCode },
    // Validate when leaving a field and on Continue, never while typing (ADR-0009); once shown, an error clears as
    // soon as it is fixed.
    mode: 'onBlur',
    reValidateMode: 'onChange',
  })
  const accountNumber = useWatch({ control, name: 'accountNumber' }).trim()
  const bankCode = useWatch({ control, name: 'bankCode' })

  // Look the account up as soon as there is a complete number and a bank. No button: the result is cached per account.
  const complete = /^\d{10}$/.test(accountNumber) && bankByCode(bankCode) !== undefined
  const lookup = useLookupAccountQuery(complete ? { accountNumber, bankCode } : skipToken)
  const verifiedName = complete ? lookup.currentData?.accountName ?? null : null
  const verification: Verification = !complete ? 'idle'
    : verifiedName ? 'verified'
      : lookup.isFetching ? 'checking'
        : isNotFound(lookup.error) ? 'not-found'
          : lookup.error ? 'failed' : 'checking'
  const verifyProblem = continuePressed ? VERIFY_PROBLEM[verification] : null

  // Keep the draft in step with the form, so the summary fills in as the merchant goes.
  useEffect(() => {
    dispatch(transferDraft.recipientEdited({ accountNumber, bankCode, accountName: verifiedName ?? '' }))
  }, [dispatch, accountNumber, bankCode, verifiedName])

  const choose = (beneficiary: Beneficiary) => {
    setContinuePressed(false)
    setValue('accountNumber', beneficiary.accountNumber, { shouldValidate: true })
    setValue('bankCode', beneficiary.bankCode, { shouldValidate: true })
    announce(`${beneficiary.accountName} selected`)
  }

  const onValid = (values: z.output<typeof recipientSchema>) => {
    const message = VERIFY_PROBLEM[verification]
    if (message) {
      setContinuePressed(true)
      announce(`There is a problem: ${message}`, 'assertive')
      setFocus('accountNumber')
      return
    }
    if (verifiedName) dispatch(transferDraft.recipientSaved({ ...values, accountName: verifiedName }))
  }

  const selected = { accountNumber, bankCode }

  // Digits only, at most 10. `inputMode="numeric"` only asks a phone for a number keypad; a desktop keyboard, or a paste,
  // can still bring letters, spaces and dashes. Cleaned before the form records the value, so the counter and the
  // lookup only ever see digits, with the caret kept after the same digit. No `maxLength`: it would cut "0123 456 789"
  // to ten characters before the spaces go. An edit that would make more than ten digits is refused with a reason,
  // rather than silently dropping the digits that do not fit.
  const accountNumberField = register('accountNumber', { onChange: () => setContinuePressed(false) })

  return (
    <StepFrame step="recipient" aside={<RecentRecipientsPanel selected={selected} onChoose={choose} />}>
      <form noValidate onSubmit={handleSubmit(onValid, (invalid) => announce(problemMessage(invalid), 'assertive'))}>
        <StepHeading>Who are you paying?</StepHeading>

        <div className="lg:hidden">
          <RecentRecipientsRow selected={selected} onChoose={choose} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="Account number"
            inputMode="numeric"
            autoComplete="off"
            placeholder="0123456789"
            trailing={`${accountNumber.length}/10`}
            error={errors.accountNumber?.message ?? verifyProblem ?? undefined}
            {...accountNumberField}
            onChange={(event) => {
              const input = event.target
              const caret = input.selectionStart ?? input.value.length
              const digits = input.value.replace(/\D/g, '')
              if (digits.length > 10) {
                const previous = getValues('accountNumber')
                input.value = previous
                input.setSelectionRange(previous.length, previous.length)
                setError('accountNumber', { type: 'input', message: 'An account number has 10 digits' })
                announce('There is a problem: An account number has 10 digits', 'assertive')
                return accountNumberField.onChange(event)
              }
              const digitsBeforeCaret = input.value.slice(0, caret).replace(/\D/g, '').length
              input.value = digits
              input.setSelectionRange(digitsBeforeCaret, digitsBeforeCaret)
              if (getFieldState('accountNumber').error?.type === 'input') clearErrors('accountNumber')
              return accountNumberField.onChange(event)
            }}
          />

          <Controller
            control={control}
            name="bankCode"
            render={({ field, fieldState }) => (
              <div>
                <Select
                  label="Bank"
                  value={field.value}
                  options={BANK_OPTIONS}
                  onChange={(code) => { setContinuePressed(false); field.onChange(code) }}
                  onBlur={field.onBlur}
                  triggerRef={field.ref}
                  invalid={fieldState.error !== undefined}
                  describedBy={fieldState.error ? bankErrorId : undefined}
                  labelClassName="mb-1.5 block text-sm font-medium text-fg"
                  triggerClassName="w-full min-h-12 text-base"
                />
                {fieldState.error ? <FieldError id={bankErrorId}>{fieldState.error.message}</FieldError> : null}
              </div>
            )}
          />
        </div>

        <VerificationPanel state={verification} name={verifiedName} bankName={bankByCode(bankCode)?.name} onRetry={() => void lookup.refetch()} />

        <StepActions>
          <span className="hidden sm:block" />
          <Button type="submit" variant="primary" className="w-full sm:w-auto sm:min-w-40">
            Continue
            <Icon name="chevron-right" className="size-4" />
          </Button>
        </StepActions>
      </form>
    </StepFrame>
  )
}

type Verification = 'idle' | 'checking' | 'verified' | 'not-found' | 'failed'

/** What Continue says for each lookup state; null where there is nothing to fix. */
const VERIFY_PROBLEM: Record<Verification, string | null> = {
  idle: null, // the schema's own messages cover an incomplete number or no bank
  checking: 'Wait for the account name to be verified',
  verified: null,
  'not-found': 'No account was found with this number at this bank',
  failed: 'The account could not be verified. Try again',
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 404
}

/**
 * The lookup's outcome, in a fixed-height slot so the button below does not jump. The status region is mounted from
 * the first render, so screen readers hear "Account verified" when it arrives (ADR-0012). The retry button sits
 * outside it, so it is not read out as part of the message.
 */
function VerificationPanel({ state, name, bankName, onRetry }: { state: Verification; name: string | null; bankName: string | undefined; onRetry: () => void }) {
  return (
    <div className="mt-4 flex min-h-[4.5rem] items-stretch gap-2">
      <div role="status" aria-live="polite" className="flex min-w-0 flex-1">
        {state === 'idle' ? (
          <p className="flex flex-1 items-center gap-2 rounded-2xl border border-dashed border-border px-4 text-sm text-fg-muted">
            <Icon name="check-circle" className="size-4" />
            The account name appears here once the number and bank are in.
          </p>
        ) : null}
        {state === 'checking' ? (
          <p className="flex flex-1 items-center gap-3 rounded-2xl bg-surface-muted px-4 text-sm text-fg">
            <Icon name="refresh" className="size-4 animate-spin text-fg-muted" />
            Verifying account…
          </p>
        ) : null}
        {state === 'verified' && name ? (
          <div className="flex flex-1 items-center gap-3 rounded-2xl bg-credit-subtle px-4 py-3">
            <Avatar name={name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-fg">
                <span className="sr-only">Account verified: </span>{name}
              </p>
              <p className="truncate text-xs text-fg-muted">{bankName}</p>
            </div>
            <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-credit" aria-hidden="true">
              <Icon name="check-circle" className="size-4" />
              Verified
            </span>
          </div>
        ) : null}
        {state === 'not-found' ? (
          <p className="flex flex-1 items-center gap-3 rounded-2xl bg-danger-subtle px-4 text-sm text-danger">
            <Icon name="x-circle" className="size-4" />
            No account found with this number at this bank.
          </p>
        ) : null}
        {state === 'failed' ? (
          <p className="flex flex-1 items-center gap-3 rounded-2xl bg-pending-subtle px-4 text-sm text-pending">
            <Icon name="alert" className="size-4" />
            We couldn&rsquo;t verify this account right now.
          </p>
        ) : null}
      </div>
      {state === 'failed' ? (
        <Button onClick={onRetry}>
          <Icon name="refresh" className="size-4" />
          Retry
        </Button>
      ) : null}
    </div>
  )
}
