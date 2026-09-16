import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useGetTransactionsPageQuery, type TransactionFilters } from '../../api/novabizApi'
import { formatCount } from '../../lib/format'
import { describeRequestError } from '../../lib/requestErrors'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { useAnnounce } from '../../components/feedback/announcerContext'
import { StateMessage } from '../../components/feedback/StateMessage'
import { Button } from '../../components/ui/Button'
import { Skeleton } from '../../components/ui/Skeleton'
import { Pagination } from './Pagination'
import type { PageSize } from './pageSize'
import { TransactionRow } from './TransactionRow'

const ROW_HEIGHT_NARROW = 72
const ROW_HEIGHT_WIDE = 64

/**
 * The transactions table (ADR-0016): cursor-paginated on the server, with rows per page from 25 to 1,000.
 *
 * The body is virtualised, so a 1,000-row page renders only the rows on screen and stays smooth on a low-end
 * phone — the brief's "1,000+ rows loaded". Because only visible rows exist, the table declares the true row count
 * for the page and each row its true index (ADR-0012).
 *
 * Pagination state lives here. A filter change remounts this component (the parent changes its key); a page-size
 * change resets to page 1 in place, so the footer — and the keyboard focus inside it — survives.
 */
export function TransactionsTable({
  filters,
  pageSize,
  onPageSizeChange,
  hasActiveFilters,
  onClearFilters,
  lastAnnouncedRef,
}: {
  filters: TransactionFilters
  pageSize: PageSize
  onPageSizeChange: (size: PageSize) => void
  hasActiveFilters: boolean
  onClearFilters: () => void
  /** Owned by the parent so it survives this component remounting. See TransactionsSection. */
  lastAnnouncedRef: RefObject<string | null>
}) {
  // Opt out of the React Compiler for this component. TanStack Virtual's virtualizer keeps one object identity while
  // its internal state changes on scroll, so the compiler's auto-memoisation served the first render's rows forever:
  // scrolling left the table body blank. Verified in a browser (rows 2–13 still rendered at scrollY 1488).
  'use no memo'
  /** The cursor for each page visited so far; the last is the current page. Page 1's cursor is null. */
  const [paging, setPaging] = useState<{ pageSize: PageSize; cursors: (string | null)[] }>({ pageSize, cursors: [null] })
  // A page-size change starts again from page 1, without remounting (see the component comment).
  const cursors = paging.pageSize === pageSize ? paging.cursors : [null]
  const setCursors = (next: (string | null)[]) => setPaging({ pageSize, cursors: next })
  const pageIndex = cursors.length - 1
  const cursor = cursors[pageIndex] ?? null

  const { currentData, data, error, isFetching, refetch } = useGetTransactionsPageQuery({ filters, limit: pageSize, cursor })
  const announce = useAnnounce()
  const isWide = useMediaQuery('(min-width: 640px)')
  const rowHeight = isWide ? ROW_HEIGHT_WIDE : ROW_HEIGHT_NARROW

  const rows = currentData?.items ?? []
  // While a new page loads, keep the footer's totals from the last page seen, so it does not jump.
  const totalCount = (currentData ?? data)?.totalCount ?? 0
  const now = new Date()

  const tableTop = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const hasRows = rows.length > 0
  useLayoutEffect(() => {
    const element = listRef.current
    if (!element) return
    const update = () => setScrollMargin(element.getBoundingClientRect().top + window.scrollY)
    update()
    window.addEventListener('resize', update)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(document.body)
    return () => {
      window.removeEventListener('resize', update)
      observer?.disconnect()
    }
  }, [hasRows])

  const virtualizer = useWindowVirtualizer({ count: rows.length, estimateSize: () => rowHeight, overscan: 8, scrollMargin })
  useEffect(() => {
    virtualizer.measure()
  }, [rowHeight, virtualizer])

  /** Move to another page, then take keyboard focus and the view to the top of the table (ADR-0012). */
  const goTo = (next: (string | null)[]) => {
    setCursors(next)
    const top = tableTop.current
    if (top) {
      top.focus({ preventScroll: true })
      if (top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: 'start' })
    }
  }

  useEffect(() => {
    if (!currentData) return
    const key = `${pageIndex}:${pageSize}:${JSON.stringify(filters)}`
    if (lastAnnouncedRef.current === key) return
    const isInitial = lastAnnouncedRef.current === null
    lastAnnouncedRef.current = key
    if (isInitial) return
    const first = pageIndex * pageSize + 1
    const last = pageIndex * pageSize + currentData.items.length
    announce(currentData.totalCount === 0
      ? 'No transactions found'
      : `Showing ${formatCount(first)} to ${formatCount(last)} of ${formatCount(currentData.totalCount)} transactions`)
  }, [currentData, pageIndex, pageSize, filters, announce, lastAnnouncedRef])

  let body
  if (!currentData && error && !isFetching) {
    const { title, detail, canRetry } = describeRequestError(error, 'transactions')
    body = (
      <StateMessage
        icon="alert"
        tone="danger"
        title={title}
        action={canRetry ? <Button onClick={() => void refetch()}>Try again</Button> : hasActiveFilters ? <Button onClick={onClearFilters}>Clear filters</Button> : null}
      >
        {detail}
      </StateMessage>
    )
  } else if (!currentData) {
    body = <SkeletonRows count={Math.min(pageSize, 10)} rowHeight={rowHeight} />
  } else if (rows.length === 0) {
    body = hasActiveFilters ? (
      <StateMessage icon="search" title="No transactions match these filters" action={<Button onClick={onClearFilters}>Clear filters</Button>}>
        Try a wider date range, or a different status.
      </StateMessage>
    ) : (
      <StateMessage icon="inbox" title="No transactions yet">
        Payments you receive by QR, POS, USSD or bank transfer will appear here.
      </StateMessage>
    )
  } else {
    body = (
      <div ref={listRef} role="rowgroup" className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const transaction = rows[virtualRow.index]
          if (!transaction) return null
          return (
            <TransactionRow
              key={transaction.id}
              transaction={transaction}
              rowIndex={virtualRow.index + 2}
              now={now}
              style={{ height: rowHeight, transform: `translateY(${virtualRow.start - scrollMargin}px)` }}
            />
          )
        })}
      </div>
    )
  }

  const showFooter = totalCount > 0 || (isFetching && pageIndex > 0)

  return (
    <div>
      <div
        ref={tableTop}
        tabIndex={-1}
        role="table"
        aria-label={`Transactions, page ${pageIndex + 1}`}
        aria-rowcount={rows.length + 1}
        aria-busy={isFetching}
        className="scroll-mt-20 focus:outline-none"
      >
        <div role="rowgroup">
          <div role="row" aria-rowindex={1} className="sr-only border-y border-border bg-surface-muted sm:not-sr-only sm:block">
            {/* Padding lives on this inner element: not-sr-only resets padding to 0 on the row itself. */}
            <div className="flex h-11 items-center gap-4 px-5 text-xs font-semibold tracking-wide text-fg-muted uppercase">
              <span role="columnheader" className="min-w-0 flex-1 pl-[3.25rem]">Transaction</span>
              <span role="columnheader" className="hidden w-48 shrink-0 lg:block">Reference</span>
              <span role="columnheader" className="w-40 shrink-0">Date</span>
              <span role="columnheader" className="w-32 shrink-0">Status</span>
              <span role="columnheader" className="w-40 shrink-0 text-right">Amount</span>
            </div>
          </div>
        </div>
        {body}
      </div>

      {showFooter ? (
        <Pagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          totalCount={totalCount}
          hasNext={Boolean(currentData?.nextCursor)}
          busy={isFetching}
          onFirst={() => goTo([null])}
          onPrevious={() => goTo(cursors.slice(0, -1))}
          onNext={() => { if (currentData?.nextCursor) goTo([...cursors, currentData.nextCursor]) }}
          onPageSizeChange={onPageSizeChange}
        />
      ) : null}
    </div>
  )
}

function SkeletonRows({ count, rowHeight }: { count: number; rowHeight: number }) {
  return (
    <div>
      <p className="sr-only" role="status">Loading transactions</p>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} aria-hidden="true" className="flex items-center gap-3 border-b border-border px-4 sm:gap-4 sm:px-5" style={{ height: rowHeight }}>
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-3/5 max-w-72" />
            <Skeleton className="h-3 w-2/5 max-w-48" />
          </div>
          <Skeleton className="h-3.5 w-20" />
        </div>
      ))}
    </div>
  )
}
