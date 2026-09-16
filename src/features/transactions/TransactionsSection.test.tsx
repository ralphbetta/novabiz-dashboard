// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, it, expect } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { setupServer } from 'msw/node'
import { makeStore } from '../../store'
import { createMockDb } from '../../mocks/db'
import { createHandlers } from '../../mocks/handlers'
import { AnnouncerProvider } from '../../components/feedback/Announcer'
import { TransactionsSection } from './TransactionsSection'

const BASE = 'http://novabiz.test'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderSection() {
  server.use(...createHandlers(createMockDb({ now: () => new Date('2026-09-16T10:30:00.000Z') })))
  const store = makeStore({ http: { baseUrl: BASE, retryBaseDelayMs: 1, retryMaxDelayMs: 2 } })
  render(
    <Provider store={store}>
      <AnnouncerProvider>
        <main><TransactionsSection /></main>
      </AnnouncerProvider>
    </Provider>,
  )
  return userEvent.setup()
}

const polite = () => screen.getByTestId('announcer-polite')
const firstPageLoaded = () => screen.findByText('1–25 of 1,200', {}, { timeout: 5000 })

describe('TransactionsSection — review findings', () => {
  it('announces the result after a filter change', async () => {
    const user = renderSection()
    await firstPageLoaded()
    const status = screen.getByRole('combobox', { name: 'Status' })
    await user.click(status)
    await user.click(screen.getByRole('option', { name: 'Failed' }))
    await waitFor(() => expect(polite()).toHaveTextContent(/^Showing 1 to \d+ of \d+ transactions$/), { timeout: 5000 })
  })

  it('announces "No transactions found" when a filter matches nothing', async () => {
    const user = renderSection()
    await firstPageLoaded()
    await user.click(screen.getByRole('combobox', { name: 'Date' }))
    await user.click(screen.getByRole('option', { name: 'Custom range' }))
    await user.type(screen.getByLabelText('From'), '2020-01-01')
    await user.type(screen.getByLabelText('To'), '2020-01-02')
    await waitFor(() => expect(polite()).toHaveTextContent('No transactions found'), { timeout: 5000 })
  })

  it('announces the new range after a rows-per-page change', async () => {
    const user = renderSection()
    await firstPageLoaded()
    const size = screen.getByRole('combobox', { name: 'Rows per page' })
    size.focus()
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    await waitFor(() => expect(polite()).toHaveTextContent('Showing 1 to 50 of 1,200 transactions'), { timeout: 5000 })
  })

  it('keeps keyboard focus on "Rows per page" after changing it', async () => {
    const user = renderSection()
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
