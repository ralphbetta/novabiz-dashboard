// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axeViolations } from '../../test/axe'
import { Pagination } from './Pagination'
import type { PageSize } from './pageSize'

function renderPagination(props: Partial<{ pageIndex: number; pageSize: PageSize; itemCount: number; totalCount: number; hasNext: boolean; busy: boolean }> = {}) {
  const handlers = { onFirst: vi.fn(), onPrevious: vi.fn(), onNext: vi.fn(), onPageSizeChange: vi.fn() }
  const { container } = render(
    <main>
      <Pagination pageIndex={0} pageSize={25} itemCount={25} totalCount={1200} hasNext busy={false} {...handlers} {...props} />
    </main>,
  )
  return { ...handlers, container, user: userEvent.setup() }
}

const button = (name: string) => screen.getByRole('button', { name })

describe('Pagination', () => {
  it('shows the range and page count on the first page', () => {
    renderPagination()
    expect(screen.getByRole('navigation', { name: 'Transaction pages' })).toBeInTheDocument()
    expect(screen.getByText('1–25 of 1,200')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 48')).toBeInTheDocument()
  })

  it('shows a partial last page', () => {
    renderPagination({ pageIndex: 48, pageSize: 25, itemCount: 10, totalCount: 1210, hasNext: false })
    expect(screen.getByText('1,201–1,210 of 1,210')).toBeInTheDocument()
    expect(screen.getByText('Page 49 of 49')).toBeInTheDocument()
    expect(button('Next page')).toBeDisabled()
    expect(button('Previous page')).toBeEnabled()
    expect(button('First page')).toBeEnabled()
  })

  it('shows "0–0 of 0" and page 1 of 1 when nothing matches', () => {
    renderPagination({ itemCount: 0, totalCount: 0, hasNext: false })
    expect(screen.getByText('0–0 of 0')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument()
    for (const name of ['First page', 'Previous page', 'Next page']) expect(button(name)).toBeDisabled()
  })

  it('shows the rows actually on the page when the total has grown since the walk began', () => {
    renderPagination({ pageIndex: 2, pageSize: 500, itemCount: 200, totalCount: 1300, hasNext: false })
    expect(screen.getByText('1,001–1,200 of 1,300')).toBeInTheDocument()
  })

  it('does not call a page the last while there is a next page', () => {
    renderPagination({ pageIndex: 48, pageSize: 25, itemCount: 25, totalCount: 1210, hasNext: true })
    expect(screen.getByText('Page 49 of 50')).toBeInTheDocument()
  })

  it('cannot go back from the first page', () => {
    renderPagination()
    expect(button('First page')).toBeDisabled()
    expect(button('Previous page')).toBeDisabled()
    expect(button('Next page')).toBeEnabled()
  })

  it('calls the matching handler for each control', async () => {
    const { user, onFirst, onPrevious, onNext } = renderPagination({ pageIndex: 3 })
    await user.click(button('Next page'))
    await user.click(button('Previous page'))
    await user.click(button('First page'))
    expect(onNext).toHaveBeenCalledOnce()
    expect(onPrevious).toHaveBeenCalledOnce()
    expect(onFirst).toHaveBeenCalledOnce()
  })

  it('disables every page control while a page is loading', () => {
    renderPagination({ pageIndex: 3, busy: true })
    for (const name of ['First page', 'Previous page', 'Next page']) expect(button(name)).toBeDisabled()
  })

  it('offers 25 to 1,000 rows per page and reports the choice as a number', async () => {
    const { user, onPageSizeChange } = renderPagination()
    const rows = screen.getByRole('combobox', { name: 'Rows per page' })
    expect(within(rows).getByText('25')).toBeInTheDocument()

    await user.click(rows)
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['25', '50', '100', '500', '1,000'])
    await user.click(screen.getByRole('option', { name: '1,000' }))
    expect(onPageSizeChange).toHaveBeenCalledExactlyOnceWith(1000)
  })

  it('has no axe violations', async () => {
    const { container } = renderPagination({ pageIndex: 2 })
    expect(await axeViolations(container)).toEqual([])
  })
})
