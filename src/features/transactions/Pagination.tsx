import { formatCount } from '../../lib/format'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Select } from '../../components/ui/Select'
import { PAGE_SIZE_OPTIONS, type PageSize } from './pageSize'
import { pageRange } from './pageRange'

/**
 * The table's footer: rows per page, the range shown, and page controls.
 *
 * Previous and Next, not numbered pages: the API paginates by cursor (ADR-0016), which is stable when new
 * transactions arrive but cannot jump to an arbitrary page. "First page" covers the common need to jump back.
 */
export function Pagination({
  pageIndex,
  pageSize,
  itemCount,
  totalCount,
  hasNext,
  busy,
  onFirst,
  onPrevious,
  onNext,
  onPageSizeChange,
}: {
  pageIndex: number
  pageSize: PageSize
  /** Rows on the page being shown. */
  itemCount: number
  totalCount: number
  hasNext: boolean
  busy: boolean
  onFirst: () => void
  onPrevious: () => void
  onNext: () => void
  onPageSizeChange: (size: PageSize) => void
}) {
  const { first: firstRow, last: lastRow, total, pageCount } = pageRange({ pageIndex, pageSize, itemCount, totalCount, hasNext })
  const hasPrevious = pageIndex > 0

  return (
    <nav aria-label="Transaction pages" className="flex flex-col gap-4 border-t border-border px-4 py-4 sm:px-5 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap-reverse items-center justify-between gap-x-6 gap-y-3 md:flex-wrap md:justify-start">
        <Select
          label="Rows per page"
          className="flex items-center gap-2"
          labelClassName="text-sm text-fg-muted"
          triggerClassName="w-24"
          value={pageSize}
          options={PAGE_SIZE_OPTIONS.map((size) => ({ value: size, label: formatCount(size) }))}
          onChange={onPageSizeChange}
        />
        <p className="text-sm text-fg-muted tabular-nums">
          {formatCount(firstRow)}–{formatCount(lastRow)} of {formatCount(total)}
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 md:justify-end">
        <Button onClick={onFirst} disabled={!hasPrevious || busy} aria-label="First page" title="First page" className="px-0">
          <Icon name="chevrons-left" className="size-4" />
        </Button>
        <Button onClick={onPrevious} disabled={!hasPrevious || busy} aria-label="Previous page" className="px-3 sm:px-4">
          <Icon name="chevron-left" className="size-4" />
          <span className="hidden sm:inline">Previous</span>
        </Button>
        <p className="px-1 text-center text-sm font-medium whitespace-nowrap text-fg tabular-nums sm:px-2">
          Page {formatCount(pageIndex + 1)} of {formatCount(pageCount)}
        </p>
        <Button onClick={onNext} disabled={!hasNext || busy} aria-label="Next page" className="px-3 sm:px-4">
          <span className="hidden sm:inline">Next</span>
          <Icon name="chevron-right" className="size-4" />
        </Button>
      </div>
    </nav>
  )
}
