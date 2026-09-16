import type { TransactionFilters } from '../../api/novabizApi'

/** How many filters are narrowing the feed. A date range counts once, whichever end is set. */
export function activeFilterCount(filters: TransactionFilters): number {
  return [filters.status, filters.type, filters.from ?? filters.to].filter((v) => v !== undefined).length
}

/** Filters behind the "Filters" toggle on narrow screens: status and date. Shown as a count on the toggle. */
export function secondaryFilterCount(filters: TransactionFilters): number {
  return [filters.status, filters.from ?? filters.to].filter((v) => v !== undefined).length
}
