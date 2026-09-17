export interface PageRange {
  first: number
  last: number
  total: number
  pageCount: number
}

/**
 * The rows a page shows, for the footer and the announcement alike, so the two cannot disagree.
 *
 * Built from what the page actually holds, not from `pageSize`. Pages are a cursor walk (ADR-0016): transactions that
 * arrive mid-walk raise `totalCount` but are not in the walk, so the last page can hold fewer rows than the total
 * implies, and there can be more pages than the total implies. Earlier pages in the walk are always full: the server
 * returns a next cursor only after a full page.
 */
export function pageRange({ pageIndex, pageSize, itemCount, totalCount, hasNext }: {
  pageIndex: number
  pageSize: number
  itemCount: number
  totalCount: number
  hasNext: boolean
}): PageRange {
  const first = itemCount === 0 ? 0 : pageIndex * pageSize + 1
  const last = itemCount === 0 ? 0 : pageIndex * pageSize + itemCount
  const total = Math.max(totalCount, last)
  const pageCount = Math.max(1, Math.ceil(total / pageSize), pageIndex + 1 + (hasNext ? 1 : 0))
  return { first, last, total, pageCount }
}
