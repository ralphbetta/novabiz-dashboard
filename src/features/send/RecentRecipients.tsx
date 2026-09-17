import { bankByCode } from '../../api/banks'
import type { Beneficiary } from '../../api/contracts'
import { useGetBeneficiariesQuery } from '../../api/novabizApi'
import { Avatar } from '../../components/ui/Avatar'
import { Icon } from '../../components/ui/Icon'
import { Skeleton } from '../../components/ui/Skeleton'

const LIMIT = 6

interface Props {
  selected: { accountNumber: string; bankCode: string }
  onChoose: (beneficiary: Beneficiary) => void
}

const isSelected = (b: Beneficiary, selected: Props['selected']) =>
  b.accountNumber === selected.accountNumber && b.bankCode === selected.bankCode

/** People the merchant has paid before, as a side panel on wide screens. One tap fills in the account details. */
export function RecentRecipientsPanel({ selected, onChoose }: Props) {
  const { data, isLoading } = useGetBeneficiariesQuery()
  const recent = data?.items.slice(0, LIMIT) ?? []
  if (!isLoading && recent.length === 0) return null

  return (
    <section aria-labelledby="recent-recipients-panel" className="rounded-3xl border border-border bg-surface p-4">
      <h2 id="recent-recipients-panel" className="px-2 pt-1 pb-3 text-xs font-semibold tracking-wide text-fg-muted uppercase">Recent recipients</h2>
      {isLoading ? (
        <div className="space-y-2 px-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      ) : (
        <ul className="space-y-1">
          {recent.map((beneficiary) => {
            const active = isSelected(beneficiary, selected)
            return (
              <li key={`${beneficiary.bankCode}:${beneficiary.accountNumber}`}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChoose(beneficiary)}
                  className={`flex w-full items-center gap-3 rounded-2xl p-2 text-left transition ${active ? 'bg-surface-muted' : 'hover:bg-surface-muted'}`}
                >
                  <Avatar name={beneficiary.accountName} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-fg">{beneficiary.accountName}</span>
                    <span className="block truncate text-xs text-fg-muted">
                      {bankByCode(beneficiary.bankCode)?.shortName ?? 'Bank'} · <span aria-hidden="true">••••</span>
                      <span className="sr-only">account ending </span>{beneficiary.accountNumber.slice(-4)}
                    </span>
                  </span>
                  {active ? <Icon name="check-circle" className="size-5 text-accent" /> : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** The same list for phones: one row of avatars that scrolls sideways, so it costs one line of height. */
export function RecentRecipientsRow({ selected, onChoose }: Props) {
  const { data, isLoading } = useGetBeneficiariesQuery()
  const recent = data?.items.slice(0, LIMIT) ?? []
  if (!isLoading && recent.length === 0) return null

  // The list bleeds to the card's edges: its negative margin matches the card's padding at each width (StepFrame).
  return (
    <section aria-labelledby="recent-recipients-row" className="mb-5">
      <h3 id="recent-recipients-row" className="mb-2 text-xs font-semibold tracking-wide text-fg-muted uppercase">Recent</h3>
      {isLoading ? (
        <div className="flex gap-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="size-11 rounded-full" />)}</div>
      ) : (
        <ul className="-mx-5 flex gap-1 overflow-x-auto px-3 pb-1 sm:-mx-8 sm:px-6">
          {recent.map((beneficiary) => {
            const active = isSelected(beneficiary, selected)
            return (
              <li key={`${beneficiary.bankCode}:${beneficiary.accountNumber}`} className="shrink-0">
                <button
                  type="button"
                  aria-pressed={active}
                  aria-label={`${beneficiary.accountName}, ${bankByCode(beneficiary.bankCode)?.shortName ?? 'bank'}, account ending ${beneficiary.accountNumber.slice(-4)}`}
                  onClick={() => onChoose(beneficiary)}
                  className={`flex w-18 flex-col items-center gap-1 rounded-2xl px-1 py-2 ${active ? 'bg-surface-muted' : ''}`}
                >
                  <Avatar name={beneficiary.accountName} />
                  <span aria-hidden="true" className="w-full truncate text-center text-xs text-fg">{beneficiary.accountName.split(' ')[0]}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
