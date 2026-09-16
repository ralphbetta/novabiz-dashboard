import { useId, useRef, useState } from 'react'
import type { TransactionFilters } from '../../api/novabizApi'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { FeedFilters } from './FeedFilters'
import { activeFilterCount, secondaryFilterCount } from './filters'
import { PAGE_SIZE_OPTIONS, type PageSize } from './pageSize'
import { TransactionsTable } from './TransactionsTable'

/**
 * The full-width transactions panel: heading and filters, then the paginated table.
 *
 * Filters and page size live in component state: they describe what this panel shows, nothing else reads them, and
 * the query cache — keyed by them — already remembers the results.
 *
 * Changing filters remounts the table, returning it to page 1. Changing the page size does NOT: the table resets to
 * page 1 itself, so the footer holding the focused rows-per-page control stays mounted and keyboard focus is kept.
 */
export function TransactionsSection() {
  const panelId = useId()
  const [filters, setFilters] = useState<TransactionFilters>({})
  const [pageSize, setPageSize] = useState<PageSize>(PAGE_SIZE_OPTIONS[0])
  const [filtersOpen, setFiltersOpen] = useState(false)
  // Remounting the filters on "Clear" resets their own local state (date preset, custom range) with the query.
  const [filtersKey, setFiltersKey] = useState(0)
  const clear = () => {
    setFilters({})
    setFiltersKey((k) => k + 1)
  }
  const hiddenCount = secondaryFilterCount(filters)
  // What the table last announced. Held here, not in the table, so it survives the table remounting on a filter
  // change — otherwise every post-filter result looked like a first load and was never announced.
  const lastAnnouncedRef = useRef<string | null>(null)

  return (
    <section id="transactions" aria-labelledby="transactions-heading" className="scroll-mt-20 overflow-hidden rounded-3xl border border-border bg-surface">
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        {/* The page header already says what this is; the heading remains for screen readers and landmarks. */}
        <h2 id="transactions-heading" className="sr-only">All transactions</h2>
        <div className="flex min-h-11 items-center justify-between gap-3 sm:hidden">
          <p className="text-sm font-medium text-fg">Filter transactions</p>
          <Button className="sm:hidden" aria-expanded={filtersOpen} aria-controls={panelId} onClick={() => setFiltersOpen((o) => !o)}>
            <Icon name="sliders" className="size-4" />
            Filters
            {hiddenCount > 0 ? (
              <span className="grid size-5 place-items-center rounded-full bg-accent text-xs text-accent-fg">
                {hiddenCount}
                <span className="sr-only"> active</span>
              </span>
            ) : null}
          </Button>
        </div>
        <FeedFilters key={filtersKey} value={filters} onChange={setFilters} open={filtersOpen} panelId={panelId} />
      </div>
      <TransactionsTable
        key={JSON.stringify(filters)}
        lastAnnouncedRef={lastAnnouncedRef}
        filters={filters}
        pageSize={pageSize}
        onPageSizeChange={setPageSize}
        hasActiveFilters={activeFilterCount(filters) > 0}
        onClearFilters={clear}
      />
    </section>
  )
}
