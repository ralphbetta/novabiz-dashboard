import { describe, it, expect } from 'vitest'
import { pageRange } from './pageRange'

describe('pageRange', () => {
  it('describes a full first page', () => {
    expect(pageRange({ pageIndex: 0, pageSize: 25, itemCount: 25, totalCount: 1200, hasNext: true })).toEqual({
      first: 1, last: 25, total: 1200, pageCount: 48,
    })
  })

  it('ends the range at the rows actually on the page, not at a full page', () => {
    // Page 3 of 500 holds the 200 rows left in the walk, even though 100 transactions arrived since page 1 and the
    // total is now 1,300. Assuming a full page would claim rows 1,001–1,300.
    expect(pageRange({ pageIndex: 2, pageSize: 500, itemCount: 200, totalCount: 1300, hasNext: false })).toMatchObject({
      first: 1001, last: 1200,
    })
  })

  it('never reports this as the last page while there is a next page', () => {
    // The total says 49 pages, but the server says there is more after page 49.
    expect(pageRange({ pageIndex: 48, pageSize: 25, itemCount: 25, totalCount: 1210, hasNext: true }).pageCount).toBe(50)
  })

  it('never reports fewer pages than the page being shown', () => {
    expect(pageRange({ pageIndex: 5, pageSize: 25, itemCount: 10, totalCount: 30, hasNext: false }).pageCount).toBe(6)
  })

  it('never reports a total below the last row shown', () => {
    expect(pageRange({ pageIndex: 1, pageSize: 25, itemCount: 25, totalCount: 40, hasNext: false }).total).toBe(50)
  })

  it('describes an empty result as 0–0 of 0, page 1 of 1', () => {
    expect(pageRange({ pageIndex: 0, pageSize: 25, itemCount: 0, totalCount: 0, hasNext: false })).toEqual({
      first: 0, last: 0, total: 0, pageCount: 1,
    })
  })
})
