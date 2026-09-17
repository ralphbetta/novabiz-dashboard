// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { makeStore } from '../../store'
import { connectivity } from '../../store/connectivitySlice'
import { preferences } from '../../store/preferencesSlice'
import { ThemeToggle } from '../../app/ThemeToggle'
import { axeViolations } from '../../test/axe'
import { BACK_ONLINE_MS, ConnectionBanner } from './ConnectionBanner'
import { OfflineNote } from './OfflineNote'

afterEach(() => { vi.useRealTimers() })

function renderWith(ui: React.ReactNode) {
  // A data service that never becomes ready: nothing here makes requests.
  const store = makeStore({ serviceReady: new Promise<void>(() => {}) })
  const view = render(<Provider store={store}>{ui}</Provider>)
  return { store, ...view }
}

const goOffline = (store: ReturnType<typeof makeStore>) => act(() => { store.dispatch(connectivity.connectionChanged({ online: false })) })
const goOnline = (store: ReturnType<typeof makeStore>) => act(() => { store.dispatch(connectivity.connectionChanged({ online: true })) })

describe('ConnectionBanner', () => {
  it('is an empty live region while online, so a later message is announced', async () => {
    const { store, container } = renderWith(<ConnectionBanner />)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    goOffline(store)
    expect(screen.getByRole('status')).not.toBeEmptyDOMElement()
    expect(await axeViolations(container)).toEqual([]) // with real timers: axe does not finish under fake ones
  })

  it('says the merchant is offline for as long as they are, then that they are back, then closes', () => {
    vi.useFakeTimers()
    const { store } = renderWith(<ConnectionBanner />)
    goOffline(store)
    expect(screen.getByRole('status')).toHaveTextContent('You’re offline. You can still see what was already loaded. Sending money is paused until you’re back online.')

    act(() => { vi.advanceTimersByTime(60_000) })
    expect(screen.getByRole('status')).toHaveTextContent('You’re offline.')

    goOnline(store)
    expect(screen.getByRole('status')).toHaveTextContent('You’re back online.')
    act(() => { vi.advanceTimersByTime(BACK_ONLINE_MS) })
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('goes straight back to the offline message if the connection drops again while saying it is back', () => {
    vi.useFakeTimers()
    const { store } = renderWith(<ConnectionBanner />)
    goOffline(store)
    goOnline(store)
    goOffline(store)
    expect(screen.getByRole('status')).toHaveTextContent('You’re offline.')
    goOnline(store)
    act(() => { vi.advanceTimersByTime(BACK_ONLINE_MS - 1) })
    expect(screen.getByRole('status')).toHaveTextContent('You’re back online.')
  })
})

describe('OfflineNote', () => {
  it('shows when loaded data was loaded, only while offline', () => {
    const { store } = renderWith(<OfflineNote loadedAt={new Date('2026-09-16T13:32:00.000Z')} />)
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument()
    goOffline(store)
    expect(screen.getByText('Offline · as of 14:32')).toBeInTheDocument() // business time, WAT
  })

  it('shows nothing when nothing has loaded', () => {
    const { store } = renderWith(<OfflineNote loadedAt={undefined} />)
    goOffline(store)
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument()
  })
})

describe('ThemeToggle', () => {
  it('shows the theme in use and saves the opposite as the merchant’s choice', async () => {
    const user = userEvent.setup()
    const { store, container } = renderWith(<ThemeToggle />)
    const toggle = screen.getByRole('button', { name: 'Dark mode' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false') // following a light phone (jsdom has no matchMedia)
    expect(await axeViolations(container)).toEqual([])

    await user.click(toggle)
    expect(store.getState().preferences.theme).toBe('dark')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')

    await user.click(toggle)
    expect(store.getState().preferences.theme).toBe('light')
  })

  it('in the phone menu, is a labelled row that does the same', async () => {
    const user = userEvent.setup()
    const { store, container } = renderWith(<ThemeToggle placement="menu" />)
    const toggle = screen.getByRole('button', { name: 'Dark mode' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(await axeViolations(container)).toEqual([])
    await user.click(toggle)
    expect(store.getState().preferences.theme).toBe('dark')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('reflects a saved dark choice', () => {
    const { store } = renderWith(<ThemeToggle />)
    act(() => { store.dispatch(preferences.themeChosen({ theme: 'dark' })) })
    expect(screen.getByRole('button', { name: 'Dark mode' })).toHaveAttribute('aria-pressed', 'true')
  })
})
