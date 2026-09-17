import { useId, useState } from 'react'
import type { TransactionStatus, TransactionType } from '../../api/contracts'
import type { TransactionFilters } from '../../api/novabizApi'
import { businessDateDaysAgo } from '../../lib/format'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Select, type SelectOption } from '../../components/ui/Select'
import { activeFilterCount } from './filters'

type DatePreset = 'all' | 'today' | '7d' | '30d' | 'custom'

const DATE_OPTIONS: SelectOption<DatePreset>[] = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom range' },
]

const STATUS_OPTIONS: SelectOption<'' | TransactionStatus>[] = [
  { value: '', label: 'All statuses' },
  { value: 'successful', label: 'Successful' },
  { value: 'pending', label: 'Pending' },
  { value: 'failed', label: 'Failed' },
]

const TYPE_OPTIONS: { value: TransactionType | undefined; label: string }[] = [
  { value: undefined, label: 'All' },
  { value: 'credit', label: 'Money in' },
  { value: 'debit', label: 'Money out' },
]

/**
 * Feed filters, applied on the server (ADR-0008). Direction is always visible, as the most-used filter. Status and
 * date sit behind a toggle on narrow screens and inline from 640px, so the feed stays above the fold at 360px.
 *
 * Radios and date inputs are native, for built-in keyboard support and each phone's own date picker. Status and
 * date use the app's Select, which follows the WAI-ARIA combobox pattern. A custom range applies only once valid.
 */
export function FeedFilters({
  value,
  onChange,
  open,
  panelId,
}: {
  value: TransactionFilters
  onChange: (next: TransactionFilters) => void
  /** Whether the status and date panel is shown on narrow screens. Always shown from 640px. */
  open: boolean
  panelId: string
}) {
  const id = useId()
  const [preset, setPreset] = useState<DatePreset>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const today = businessDateDaysAgo(0, new Date())

  const set = (patch: Partial<TransactionFilters>) => {
    const next = { ...value, ...patch }
    // Drop cleared keys entirely, so equivalent filters share one cache entry.
    onChange(Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as TransactionFilters)
  }

  const rangeInvalid = preset === 'custom' && customFrom !== '' && customTo !== '' && customFrom > customTo

  const applyCustom = (from: string, to: string) => {
    if (from !== '' && to !== '' && from > to) return // shown as an error; the last valid range stays applied
    set({ from: from || undefined, to: to || undefined })
  }

  const choosePreset = (next: DatePreset) => {
    setPreset(next)
    if (next === 'all') set({ from: undefined, to: undefined })
    if (next === 'today') set({ from: today, to: today })
    if (next === '7d') set({ from: businessDateDaysAgo(6, new Date()), to: today })
    if (next === '30d') set({ from: businessDateDaysAgo(29, new Date()), to: today })
    if (next === 'custom') applyCustom(customFrom, customTo)
  }

  const clear = () => {
    setPreset('all')
    setCustomFrom('')
    setCustomTo('')
    onChange({})
  }

  const fieldClass = 'min-h-11 w-full rounded-xl border border-border-field bg-surface text-sm text-fg hover:border-border-strong'
  const labelClass = 'mb-1 block text-xs font-medium text-fg-muted'

  return (
    // One toolbar row from 640px: direction, status, date, custom range and clear, bottom-aligned. On narrow screens
    // status and date sit in a panel behind the Filters toggle; from 640px that panel uses display: contents, so its
    // fields join this row directly.
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <fieldset className="min-w-0 sm:w-80">
        <legend className="sr-only">Direction</legend>
        <div className="grid grid-cols-3 rounded-xl bg-surface-muted p-1">
          {TYPE_OPTIONS.map((option) => (
            <label key={option.label} className="relative">
              <input
                type="radio"
                name={`${id}-type`}
                className="peer sr-only"
                checked={value.type === option.value}
                onChange={() => set({ type: option.value })}
              />
              <span className="flex min-h-9 cursor-pointer items-center justify-center rounded-lg px-2 text-sm font-medium whitespace-nowrap text-fg-muted transition peer-checked:bg-surface peer-checked:text-fg peer-checked:shadow-sm peer-focus-visible:outline-3 peer-focus-visible:outline-focus dark:peer-checked:ring-1 dark:peer-checked:ring-border-strong">
                {option.label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div id={panelId} className={`${open ? 'flex' : 'hidden'} flex-col gap-3 sm:contents`}>
        <Select
          label="Status"
          className="sm:w-48"
          value={value.status ?? ''}
          options={STATUS_OPTIONS}
          onChange={(status) => set({ status: (status || undefined) as TransactionStatus | undefined })}
        />

        <Select
          label="Date"
          className="sm:w-48"
          value={preset}
          options={DATE_OPTIONS}
          onChange={choosePreset}
        />

        {preset === 'custom' ? (
          <div className="grid grid-cols-2 gap-3 sm:w-[24.75rem]">
            <div>
              <label htmlFor={`${id}-from`} className={labelClass}>From</label>
              <input
                id={`${id}-from`}
                type="date"
                max={today}
                value={customFrom}
                aria-invalid={rangeInvalid}
                aria-describedby={rangeInvalid ? `${id}-range-error` : undefined}
                onChange={(e) => { setCustomFrom(e.target.value); applyCustom(e.target.value, customTo) }}
                className={`${fieldClass} px-3 aria-invalid:border-danger`}
              />
            </div>
            <div>
              <label htmlFor={`${id}-to`} className={labelClass}>To</label>
              <input
                id={`${id}-to`}
                type="date"
                max={today}
                value={customTo}
                aria-invalid={rangeInvalid}
                aria-describedby={rangeInvalid ? `${id}-range-error` : undefined}
                onChange={(e) => { setCustomTo(e.target.value); applyCustom(customFrom, e.target.value) }}
                className={`${fieldClass} px-3 aria-invalid:border-danger`}
              />
            </div>
            {rangeInvalid ? (
              <p id={`${id}-range-error`} className="col-span-2 flex items-center gap-1.5 text-sm text-danger">
                <Icon name="alert" className="size-4 shrink-0" />
                The start date must be on or before the end date.
              </p>
            ) : null}
          </div>
        ) : null}

        {activeFilterCount(value) > 0 ? (
          <Button variant="ghost" onClick={clear} className="self-start sm:self-end">
            <Icon name="x" className="size-4" />
            Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  )
}
