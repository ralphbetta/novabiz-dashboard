// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { setupServer } from 'msw/node'
import { makeStore } from '../../store'
import { createMockDb } from '../../mocks/db'
import { createHandlers } from '../../mocks/handlers'
import { TIMEOUT_HOLD_MS, createChaosController } from '../../mocks/chaos'
import { formatNaira, formatSignedNaira, toKobo } from '../../lib/money'
import { AnnouncerProvider } from '../../components/feedback/Announcer'
import { AnnouncerContext, type Announce } from '../../components/feedback/announcerContext'
import { axeViolations } from '../../test/axe'
import { BalanceOverview } from './BalanceOverview'

const BASE = 'http://novabiz.test'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderOverview({ gate, errorRate = 0, announce }: { gate?: Promise<void>; errorRate?: number; announce?: Announce } = {}) {
  const db = createMockDb({ now: () => new Date('2026-09-16T10:30:00.000Z') })
  /** Requests wait on this before the mock answers. `hold()` swaps it to hold later requests. */
  const gates = { current: gate ?? Promise.resolve() }
  const chaos = createChaosController({
    settings: { latencyMs: 0, jitterMs: 0, errorRate },
    random: () => 0.5,
    sleep: (ms) => (ms === TIMEOUT_HOLD_MS ? new Promise<never>(() => {}) : Promise.resolve()),
  })
  let answered = 0
  server.use(...createHandlers(db, { chaos, beforeProcessing: async () => { await gates.current; answered++ } }))
  const store = makeStore({ http: { baseUrl: BASE, retryBaseDelayMs: 1, retryMaxDelayMs: 2 } })
  const tree = (showOverview: boolean) => {
    const page = <main>{showOverview ? <BalanceOverview /> : <p>Another page</p>}</main>
    return (
      <Provider store={store}>
        {announce ? <AnnouncerContext.Provider value={announce}>{page}</AnnouncerContext.Provider> : <AnnouncerProvider>{page}</AnnouncerProvider>}
      </Provider>
    )
  }
  const { container, rerender } = render(tree(true))
  /** Holds the next requests; returns a function that releases them and waits until `count` have been answered. */
  const hold = () => {
    let release = () => {}
    gates.current = new Promise<void>((resolve) => { release = resolve })
    const answeredBefore = answered
    return async (count = 1) => {
      release()
      await waitFor(() => expect(answered - answeredBefore).toBeGreaterThanOrEqual(count))
      // Let the response reach the store and any awaiting component code.
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  const balance = db.getBalance()
  if (!balance.ok) throw new Error('seed balance unavailable')
  const b = balance.value
  const amounts = {
    available: formatNaira(toKobo(b.availableBalanceKobo)),
    moneyIn: formatSignedNaira(toKobo(b.todayInflowKobo), 'credit'),
    moneyOut: formatSignedNaira(toKobo(b.todayOutflowKobo), 'debit'),
  }
  // The seed has pending transfers, so some money is on hold; the hide test relies on that amount being shown.
  const onHold = formatNaira(toKobo(b.ledgerBalanceKobo - b.availableBalanceKobo))
  return { user: userEvent.setup(), chaos, amounts, onHold, container, hold, leavePage: () => rerender(tree(false)) }
}

const section = () => screen.getByRole('region', { name: 'Account overview' })
const polite = () => screen.getByTestId('announcer-polite')

describe('BalanceOverview', () => {
  it('shows a loading state until the balance arrives, then the amounts', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { amounts } = renderOverview({ gate })

    expect(screen.getByText('Loading your balance')).toBeInTheDocument()
    expect(section()).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText(amounts.available)).not.toBeInTheDocument()

    release()
    expect(await screen.findByText(amounts.available, {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText(amounts.moneyIn)).toBeInTheDocument()
    expect(screen.getByText(amounts.moneyOut)).toBeInTheDocument()
    expect(screen.queryByText('Loading your balance')).not.toBeInTheDocument()
    expect(section()).toHaveAttribute('aria-busy', 'false')
  })

  it('hides every amount, for screens seen by others, and shows them again', async () => {
    const { user, amounts, onHold } = renderOverview()
    await screen.findByText(amounts.available, {}, { timeout: 5000 })
    expect(onHold).not.toBe(formatNaira(toKobo(0)))
    expect(screen.getByText(`${onHold} on hold for pending transfers`)).toBeInTheDocument()

    const hide = screen.getByRole('button', { name: 'Hide amounts' })
    expect(hide).toHaveAttribute('aria-pressed', 'false')
    await user.click(hide)

    const show = screen.getByRole('button', { name: 'Show amounts' })
    expect(show).toHaveAttribute('aria-pressed', 'true')
    // No amount of any size may remain: no kobo digits, and no ₦ followed by a digit or sign.
    const text = document.body.textContent ?? ''
    for (const amount of [...Object.values(amounts), onHold]) expect(text).not.toContain(amount)
    expect(text).not.toMatch(/\d\.\d{2}/)
    expect(text).not.toMatch(/₦\s*[\d-]/)
    expect(screen.getByText('Balance hidden')).toBeInTheDocument()
    expect(screen.getAllByText('Hidden')).toHaveLength(2)

    await user.click(show)
    for (const amount of Object.values(amounts)) expect(screen.getByText(amount)).toBeInTheDocument()
    expect(screen.getByText(`${onHold} on hold for pending transfers`)).toBeInTheDocument()
  })

  it('shows an error with a working "Try again" when the balance cannot load', async () => {
    const { user, chaos, amounts } = renderOverview({ errorRate: 1 })

    expect(await screen.findByText(/Couldn.t load your balance/, {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText('Something went wrong on our side. Try again in a moment.')).toBeInTheDocument()
    expect(screen.queryByText(amounts.available)).not.toBeInTheDocument()
    expect(screen.getAllByText('Unavailable')).toHaveLength(2)

    chaos.update({ errorRate: 0 })
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(amounts.available, {}, { timeout: 5000 })).toBeInTheDocument()
    await waitFor(() => expect(polite()).toHaveTextContent('Balance updated'))
  })

  it('announces a refresh, and keeps the last known balance when a refresh fails', async () => {
    const { user, chaos, amounts } = renderOverview()
    await screen.findByText(amounts.available, {}, { timeout: 5000 })

    await user.click(screen.getByRole('button', { name: 'Refresh balance' }))
    await waitFor(() => expect(polite()).toHaveTextContent('Balance updated'), { timeout: 5000 })

    chaos.update({ errorRate: 1 })
    await user.click(screen.getByRole('button', { name: 'Refresh balance' }))
    await waitFor(() => expect(polite()).toHaveTextContent('Balance could not be updated'), { timeout: 5000 })
    expect(screen.getByText(amounts.available)).toBeInTheDocument()
    expect(screen.getByText(/Couldn.t refresh · as of/)).toBeInTheDocument()
  })

  it('announces once when Refresh is pressed twice quickly', async () => {
    const announce = vi.fn<Announce>()
    const { amounts, hold } = renderOverview({ announce })
    await screen.findByText(amounts.available, {}, { timeout: 5000 })

    const release = hold()
    const refresh = screen.getByRole('button', { name: 'Refresh balance' })
    // Two clicks before React re-renders: the button cannot have been disabled in between.
    fireEvent.click(refresh)
    fireEvent.click(refresh)
    await release()
    expect(announce.mock.calls).toEqual([['Balance updated']])
  })

  it('does not announce a refresh that finishes after the merchant has left the page', async () => {
    const announce = vi.fn<Announce>()
    const { amounts, hold, leavePage } = renderOverview({ announce })
    await screen.findByText(amounts.available, {}, { timeout: 5000 })

    const release = hold()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh balance' }))
    leavePage()
    await release()
    expect(announce).not.toHaveBeenCalled()
  })

  it('has no axe violations once loaded', async () => {
    const { amounts, container } = renderOverview()
    await screen.findByText(amounts.available, {}, { timeout: 5000 })
    expect(await axeViolations(container)).toEqual([])
  })
})
