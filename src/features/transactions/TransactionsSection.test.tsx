// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, it, expect } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { setupServer } from 'msw/node'
import { makeStore } from '../../store'
import { createMockDb } from '../../mocks/db'
import { SendMoneyRequestSchema } from '../../api/contracts'
import { createHandlers } from '../../mocks/handlers'
import { AnnouncerProvider } from '../../components/feedback/Announcer'
import { TransactionsSection } from './TransactionsSection'

const BASE = 'http://novabiz.test'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderSection() {
  const db = createMockDb({ now: () => new Date('2026-09-16T10:30:00.000Z') })
  server.use(...createHandlers(db))
  const store = makeStore({ http: { baseUrl: BASE, retryBaseDelayMs: 1, retryMaxDelayMs: 2 } })
  render(
    <Provider store={store}>
      <AnnouncerProvider>
        <main><TransactionsSection /></main>
      </AnnouncerProvider>
    </Provider>,
  )
  return { user: userEvent.setup(), db }
}

const polite = () => screen.getByTestId('announcer-polite')
const firstPageLoaded = () => screen.findByText('1–25 of 1,200', {}, { timeout: 5000 })

describe('TransactionsSection — review findings', () => {
  it('announces the result after a filter change', async () => {
    const { user } = renderSection()
    await firstPageLoaded()
    const status = screen.getByRole('combobox', { name: 'Status' })
    await user.click(status)
    await user.click(screen.getByRole('option', { name: 'Failed' }))
    await waitFor(() => expect(polite()).toHaveTextContent(/^Showing 1 to \d+ of \d+ transactions$/), { timeout: 5000 })
  })

  it('announces "No transactions found" when a filter matches nothing', async () => {
    const { user } = renderSection()
    await firstPageLoaded()
    await user.click(screen.getByRole('combobox', { name: 'Date' }))
    await user.click(screen.getByRole('option', { name: 'Custom range' }))
    await user.type(screen.getByLabelText('From'), '2020-01-01')
    await user.type(screen.getByLabelText('To'), '2020-01-02')
    await waitFor(() => expect(polite()).toHaveTextContent('No transactions found'), { timeout: 5000 })
  })

  it('announces the new range after a rows-per-page change', async () => {
    const { user } = renderSection()
    await firstPageLoaded()
    const size = screen.getByRole('combobox', { name: 'Rows per page' })
    size.focus()
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    await waitFor(() => expect(polite()).toHaveTextContent('Showing 1 to 50 of 1,200 transactions'), { timeout: 5000 })
  })

  it('keeps keyboard focus on "Rows per page" after changing it', async () => {
    const { user } = renderSection()
    await firstPageLoaded()
    const size = screen.getByRole('combobox', { name: 'Rows per page' })
    size.focus()
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    await screen.findByText('1–50 of 1,200', {}, { timeout: 5000 })
    const after = screen.getByRole('combobox', { name: 'Rows per page' })
    expect(within(after).getByText('50')).toBeInTheDocument()
    expect(after).toHaveFocus()
  })
})

describe('TransactionsSection — changing page', () => {
  it('moves keyboard focus to the top of the table and announces the new range', async () => {
    const { user } = renderSection()
    await firstPageLoaded()
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByText('26–50 of 1,200', {}, { timeout: 5000 })
    expect(screen.getByRole('table', { name: 'Transactions, page 2' })).toHaveFocus()
    await waitFor(() => expect(polite()).toHaveTextContent('Showing 26 to 50 of 1,200 transactions'), { timeout: 5000 })

    await user.click(screen.getByRole('button', { name: 'Previous page' }))
    await screen.findByText('1–25 of 1,200', {}, { timeout: 5000 })
    expect(screen.getByRole('table', { name: 'Transactions, page 1' })).toHaveFocus()
    await waitFor(() => expect(polite()).toHaveTextContent('Showing 1 to 25 of 1,200 transactions'), { timeout: 5000 })
  })

  it('shows the same range in the footer as it announces when transactions arrive mid-walk', async () => {
    // ADR-0016's case: new transactions arrive while the merchant is paging. The cursor walk does not include them,
    // so the last page holds fewer rows than the new total implies.
    const { user, db } = renderSection()
    await firstPageLoaded()
    const size = screen.getByRole('combobox', { name: 'Rows per page' })
    size.focus()
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}') // the first press opens the list
    await screen.findByText('1–500 of 1,200', {}, { timeout: 5000 })

    for (let i = 0; i < 100; i++) {
      const created = db.createTransfer(
        SendMoneyRequestSchema.parse({ recipient: { accountNumber: '0123456789', bankCode: '058', accountName: 'Ngozi Okafor' }, amountKobo: 10_000 }),
        `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      )
      expect(created.ok).toBe(true)
    }

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByText('501–1,000 of 1,300', {}, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(polite()).toHaveTextContent(/^Showing 1,001 to 1,200 of 1,300 transactions$/), { timeout: 5000 })
    expect(screen.getByText('1,001–1,200 of 1,300')).toBeInTheDocument()
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()
  })
})
