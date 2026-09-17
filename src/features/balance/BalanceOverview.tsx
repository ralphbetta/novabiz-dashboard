import { useEffect, useRef, useState } from 'react'
import { useGetBalanceQuery } from '../../api/novabizApi'
import type { Kobo } from '../../lib/money'
import { formatNaira, formatSignedNaira, subtractKobo } from '../../lib/money'
import { formatTime } from '../../lib/format'
import { describeRequestError } from '../../lib/requestErrors'
import { useAnnounce } from '../../components/feedback/announcerContext'
import { Button, IconButton } from '../../components/ui/Button'
import { Icon, type IconName } from '../../components/ui/Icon'
import { Skeleton } from '../../components/ui/Skeleton'

const HIDDEN = '••••••'

/**
 * The account summary: available balance, and today's money in and out.
 *
 * One query feeds all three cards. "Available" leads because it is what the merchant can actually send. The hide
 * toggle covers every amount — these phones are often shared, or used at a counter in view of customers.
 */
export function BalanceOverview() {
  const { data, error, isLoading, isFetching, refetch } = useGetBalanceQuery()
  const [hidden, setHidden] = useState(false)
  const announce = useAnnounce()
  // Both refs change without waiting for a render. `disabled={isFetching}` alone cannot stop a second quick click:
  // RTK batches the pending update, so the button can still be enabled when the second click lands.
  const refreshing = useRef(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // Announce from the refetch's own result. Watching `isFetching` for a true → false edge can miss a fast response,
  // for the same batching reason. Nothing is announced once the merchant has left the page: the announcer outlives it.
  const refresh = async () => {
    if (refreshing.current) return
    refreshing.current = true
    try {
      const result = await refetch()
      if (mounted.current) announce(result.error ? 'Balance could not be updated' : 'Balance updated')
    } finally {
      refreshing.current = false
    }
  }

  const onHold = data ? subtractKobo(data.ledgerBalanceKobo, data.availableBalanceKobo) : null

  return (
    <section aria-labelledby="overview-heading" aria-busy={isLoading}>
      <h2 id="overview-heading" className="sr-only">Account overview</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        <div className="relative overflow-hidden sm:col-span-2 rounded-3xl surface-brand p-5 text-brand-fg sm:p-6">
          <span aria-hidden="true" className="pointer-events-none absolute -top-16 -right-12 size-48 rounded-full bg-brand-raised" />
          <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <p className="flex items-center gap-2 pt-2.5 text-sm font-medium text-brand-fg-muted">
                <Icon name="wallet" className="size-4" />
                Available balance
              </p>
              <div className="-mt-1 -mr-2 flex">
                <IconButton label={hidden ? 'Show amounts' : 'Hide amounts'} aria-pressed={hidden} onClick={() => setHidden((h) => !h)} variant="ghost-on-brand">
                  <Icon name={hidden ? 'eye-off' : 'eye'} />
                </IconButton>
                <IconButton label="Refresh balance" onClick={() => void refresh()} disabled={isFetching} variant="ghost-on-brand">
                  <Icon name="refresh" className={`size-5 ${isFetching ? 'animate-spin' : ''}`} />
                </IconButton>
              </div>
            </div>

            {isLoading ? (
              <div>
                <span className="sr-only">Loading your balance</span>
                <Skeleton className="mt-2 h-10 w-56 bg-brand-raised" />
                <Skeleton className="mt-3 h-4 w-44 bg-brand-raised" />
              </div>
            ) : !data ? (
              <BalanceError error={error} onRetry={() => void refresh()} retrying={isFetching} />
            ) : (
              <>
                <p className="mt-1 text-[2rem] leading-tight font-semibold tracking-tight tabular-nums sm:text-[2.5rem]">
                  {hidden ? (
                    <>
                      <span aria-hidden="true">₦ {HIDDEN}</span>
                      <span className="sr-only">Balance hidden</span>
                    </>
                  ) : (
                    formatNaira(data.availableBalanceKobo)
                  )}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-brand-fg-muted">
                  {onHold !== null && onHold > 0 ? (
                    <span>{hidden ? HIDDEN : formatNaira(onHold)} on hold for pending transfers</span>
                  ) : null}
                  <span>
                    {error ? 'Couldn’t refresh · as of ' : 'Updated '}
                    {formatTime(new Date(data.asOf))}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        <StatCard
          label="Money in today"
          icon="arrow-down-left"
          tone="credit"
          amount={data?.todayInflowKobo}
          direction="credit"
          loading={isLoading}
          hidden={hidden}
        />
        <StatCard
          label="Money out today"
          icon="arrow-up-right"
          tone="neutral"
          amount={data?.todayOutflowKobo}
          direction="debit"
          loading={isLoading}
          hidden={hidden}
        />
      </div>
    </section>
  )
}

function StatCard({
  label,
  icon,
  tone,
  amount,
  direction,
  loading,
  hidden,
}: {
  label: string
  icon: IconName
  tone: 'credit' | 'neutral'
  amount: Kobo | undefined
  direction: 'credit' | 'debit'
  loading: boolean
  hidden: boolean
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4 sm:flex-col sm:items-stretch sm:gap-4 sm:rounded-3xl sm:p-5">
      <p className="flex items-center gap-2 text-sm font-medium text-fg-muted">
        <span aria-hidden="true" className={`grid size-8 shrink-0 place-items-center rounded-full ${tone === 'credit' ? 'bg-credit-subtle text-credit' : 'bg-surface-muted text-fg-muted'}`}>
          <Icon name={icon} className="size-4" />
        </span>
        <span className="min-w-0 leading-tight">{label}</span>
      </p>
      {loading ? (
        <Skeleton className="h-7 w-32" />
      ) : (
        <p className="shrink-0 text-lg font-semibold tracking-tight text-fg tabular-nums sm:truncate sm:text-2xl">
          {amount === undefined ? (
            <>
              <span aria-hidden="true">—</span>
              <span className="sr-only">Unavailable</span>
            </>
          ) : hidden ? (
            <>
              <span aria-hidden="true">{HIDDEN}</span>
              <span className="sr-only">Hidden</span>
            </>
          ) : (
            formatSignedNaira(amount, direction)
          )}
        </p>
      )}
    </div>
  )
}

function BalanceError({ error, onRetry, retrying }: { error: unknown; onRetry: () => void; retrying: boolean }) {
  const { title, detail, canRetry } = describeRequestError(error, 'your balance')
  return (
    <div className="mt-2">
      <p className="flex items-center gap-2 font-semibold">
        <Icon name="alert" className="size-5" />
        {title}
      </p>
      <p className="mt-1 text-sm text-brand-fg-muted">{detail}</p>
      {canRetry ? (
        <Button variant="on-brand" onClick={onRetry} disabled={retrying} className="mt-4">
          {retrying ? 'Trying again…' : 'Try again'}
        </Button>
      ) : null}
    </div>
  )
}
