// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { API } from '../../api/contracts'
import { makeStore } from '../../store'
import { createMockDb } from '../../mocks/db'
import { createHandlers } from '../../mocks/handlers'
import { TIMEOUT_HOLD_MS, createChaosController } from '../../mocks/chaos'
import { axeViolations } from '../../test/axe'
import { RecentTransactions } from './RecentTransactions'

const BASE = 'http://novabiz.test'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderRecent({ gate, override, errorRate = 0 }: { gate?: Promise<void>; errorRate?: number; override?: Parameters<typeof server.use>[0] } = {}) {
  const db = createMockDb({ now: () => new Date('2026-09-16T10:30:00.000Z') })
  const chaos = createChaosController({
    settings: { latencyMs: 0, jitterMs: 0, errorRate },
    random: () => 0.5,
    sleep: (ms) => (ms === TIMEOUT_HOLD_MS ? new Promise<never>(() => {}) : Promise.resolve()),
  })
  server.use(...createHandlers(db, { chaos, ...(gate ? { beforeProcessing: () => gate } : {}) }))
  // Registered last, so it takes precedence over the mock's own handler.
  if (override) server.use(override)
  const store = makeStore({ http: { baseUrl: BASE, retryBaseDelayMs: 1, retryMaxDelayMs: 2 } })
  const { container } = render(
    <Provider store={store}>
      <MemoryRouter>
        <main><RecentTransactions /></main>
      </MemoryRouter>
    </Provider>,
  )
  const latest = db.listTransactions({ limit: 6 })
  if (!latest.ok) throw new Error('seed transactions unavailable')
  return { user: userEvent.setup(), chaos, container, latest: latest.value.items }
}

const table = () => screen.findByRole('table', { name: 'Recent transactions' }, { timeout: 5000 })

describe('RecentTransactions', () => {
  it('shows a loading state, then the six latest transactions, newest first', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { latest } = renderRecent({ gate })

    expect(screen.getByRole('status')).toHaveTextContent('Loading recent transactions')
    release()

    const rows = within(await table()).getAllByRole('row')
    expect(rows).toHaveLength(6)
    expect(latest).toHaveLength(6)
    latest.forEach((transaction, index) => {
      expect(rows[index]).toHaveTextContent(transaction.counterparty.name)
    })
    expect(screen.queryByText('Loading recent transactions')).not.toBeInTheDocument()
  })

  it('links to the full transactions page', async () => {
    renderRecent()
    await table()
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/dashboard/transactions')
  })

  it('shows an empty state for a merchant with no transactions', async () => {
    renderRecent({ override: http.get(`*${API.transactions}`, () => HttpResponse.json({ items: [], nextCursor: null, totalCount: 0 })) })
    expect(await screen.findByRole('heading', { name: 'No transactions yet' }, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows an error with a working "Try again"', async () => {
    const { user, chaos } = renderRecent({ errorRate: 1 })
    expect(await screen.findByRole('heading', { name: /Couldn.t load transactions/ }, { timeout: 5000 })).toBeInTheDocument()

    chaos.update({ errorRate: 0 })
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(within(await table()).getAllByRole('row')).toHaveLength(6)
  })

  it('has no axe violations once loaded', async () => {
    const { container } = renderRecent()
    await table()
    expect(await axeViolations(container)).toEqual([])
  })
})
