// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnnouncerProvider } from '../../components/feedback/Announcer'
import { DEFAULT_CHAOS_SETTINGS, createChaosController } from '../../mocks/chaos'
import { CHAOS_SETTINGS_STORAGE_KEY, createStoredChaosController, loadChaosSettings, persistChaosSettings } from '../../mocks/chaosSettingsStorage'
import { axeViolations } from '../../test/axe'
import { DEFAULT_HTTP_CONFIG } from '../../api/baseQuery'
import { MockApiControls } from './MockApiControls'
import { MockControlsProvider } from './MockControlsProvider'
import type { MockControls } from './mockControlsContext'

function renderControls(controls: MockControls | Promise<MockControls | null> | null = { chaos: createChaosController(), resetData: vi.fn() }) {
  const { container } = render(
    <AnnouncerProvider>
      <MockControlsProvider controls={controls}>
        <header><MockApiControls /></header>
      </MockControlsProvider>
    </AnnouncerProvider>,
  )
  return { user: userEvent.setup(), container, controls }
}

const openPanel = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /Mock API/ }))
  return screen.getByRole('dialog', { name: 'Mock API controls', hidden: true })
}

describe('Mock API controls', () => {
  it('shows nothing without a mock, and appears once the mock has started', async () => {
    renderControls(null)
    expect(screen.queryByRole('button', { name: /Mock API/ })).not.toBeInTheDocument()

    let start: (controls: MockControls) => void = () => {}
    const starting = new Promise<MockControls | null>((resolve) => { start = resolve })
    renderControls(starting)
    expect(screen.queryByRole('button', { name: /Mock API/ })).not.toBeInTheDocument()
    await act(async () => { start({ chaos: createChaosController(), resetData: vi.fn() }) })
    expect(await screen.findByRole('button', { name: /Mock API/ })).toBeInTheDocument()
  })

  it('arms the next transfer, shows it on the badge, and clears it when a transfer uses it up', async () => {
    const chaos = createChaosController({ random: () => 0.99, sleep: () => Promise.resolve() })
    const { user } = renderControls({ chaos, resetData: vi.fn() })
    const panel = await openPanel(user)

    await user.click(within(panel).getByRole('radio', { name: /Timeout, money sent/ }))
    expect(chaos.getForced().transfer).toBe('timeout-after-commit')
    expect(within(panel).getByText('Armed: used by the next transfer you send.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mock API, 1 setting simulating failures' })).toBeInTheDocument()

    // The next transfer POST creates a transfer and claims the armed outcome.
    act(() => { chaos.decide(true); chaos.onTransferCreated('txn_1', 0.5) })
    expect(within(within(panel).getByRole('group', { name: 'Next transfer' })).getByRole('radio', { name: /Nothing forced/ })).toBeChecked()
    expect(within(panel).queryByText('Armed: used by the next transfer you send.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mock API' })).toBeInTheDocument()
  })

  it('arms a failed settlement', async () => {
    const chaos = createChaosController()
    const { user } = renderControls({ chaos, resetData: vi.fn() })
    const panel = await openPanel(user)
    const settlement = within(panel).getByRole('group', { name: 'Next settlement' })
    await user.click(within(settlement).getByRole('radio', { name: /Fails to settle/ }))
    expect(chaos.getForced().settlement).toBe('failed')
  })

  it('applies presets and sliders to the mock, and marks the preset in use', async () => {
    const chaos = createChaosController()
    const { user } = renderControls({ chaos, resetData: vi.fn() })
    const panel = await openPanel(user)

    expect(within(panel).getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(panel).getByRole('button', { name: 'Flaky' }))
    expect(chaos.getSettings()).toMatchObject({ latencyMs: 800, errorRate: 0.2, timeoutRate: 0.05 })
    expect(within(panel).getByRole('button', { name: 'Flaky' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(panel).getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'false')

    const errorRate = within(panel).getByRole('slider', { name: 'Error rate' })
    expect(errorRate).toHaveAttribute('aria-valuetext', '20%')
    // jsdom does not move a range input on arrow keys as a browser does, so set the value the way the input would.
    fireEvent.change(errorRate, { target: { value: '0.25' } })
    expect(chaos.getSettings().errorRate).toBeCloseTo(0.25)
    expect(within(panel).getByRole('slider', { name: 'Error rate' })).toHaveAttribute('aria-valuetext', '25%')
  })

  it('"Reset controls" returns to a normal server and clears anything armed', async () => {
    const chaos = createChaosController()
    chaos.update({ errorRate: 0.5, latencyMs: 5_000 })
    chaos.forceNextTransfer('error-after-commit')
    const { user } = renderControls({ chaos, resetData: vi.fn() })
    const panel = await openPanel(user)
    await user.click(within(panel).getByRole('button', { name: 'Reset controls' }))
    expect(chaos.getSettings()).toEqual(DEFAULT_CHAOS_SETTINGS)
    expect(chaos.getForced()).toEqual({ transfer: null, settlement: null })
  })

  it('asks before deleting demo data, and can be cancelled', async () => {
    const resetData = vi.fn()
    const { user } = renderControls({ chaos: createChaosController(), resetData })
    const panel = await openPanel(user)

    await user.click(within(panel).getByRole('button', { name: 'Reset demo data…' }))
    expect(resetData).not.toHaveBeenCalled()
    expect(within(panel).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(panel).getByRole('button', { name: 'Cancel' }))
    expect(within(panel).getByRole('button', { name: 'Reset demo data…' })).toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: 'Reset demo data…' }))
    await user.click(within(panel).getByRole('button', { name: 'Delete and reload' }))
    expect(resetData).toHaveBeenCalledOnce()
  })

  it('has no axe violations with the panel open', async () => {
    const { user, container } = renderControls()
    await openPanel(user)
    expect(await axeViolations(container)).toEqual([])
  })
})

describe('keeping the settings across reloads', () => {
  const memory = () => {
    const data = new Map<string, string>()
    return { data, storage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, removeItem: (k: string) => { data.delete(k) } } as unknown as Storage }
  }

  it('saves settings when they change and loads them back, but not armed outcomes', () => {
    const { storage } = memory()
    const chaos = createChaosController()
    persistChaosSettings(chaos, storage)
    chaos.update({ latencyMs: 2_500, errorRate: 0.1 })
    chaos.forceNextTransfer('timeout-after-commit')
    expect(loadChaosSettings(storage)).toEqual({ ...DEFAULT_CHAOS_SETTINGS, latencyMs: 2_500, errorRate: 0.1 })
  })

  it('ignores saved settings that are invalid, and storage that throws', () => {
    const { storage, data } = memory()
    data.set(CHAOS_SETTINGS_STORAGE_KEY, JSON.stringify({ ...DEFAULT_CHAOS_SETTINGS, errorRate: 7 }))
    expect(loadChaosSettings(storage)).toBeNull()
    data.set(CHAOS_SETTINGS_STORAGE_KEY, '{nope')
    expect(loadChaosSettings(storage)).toBeNull()
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('quota') } } as unknown as Storage
    expect(loadChaosSettings(broken)).toBeNull()
    const chaos = createChaosController()
    persistChaosSettings(chaos, broken)
    expect(() => chaos.update({ latencyMs: 1 })).not.toThrow()
  })
})

describe('Mock API controls — review findings', () => {
  const memory = () => {
    const data = new Map<string, string>()
    return { data, storage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, removeItem: (k: string) => { data.delete(k) } } as unknown as Storage }
  }

  it('novabizChaos.reset() goes back to the defaults even when settings were restored from a reload', () => {
    const { storage, data } = memory()
    data.set(CHAOS_SETTINGS_STORAGE_KEY, JSON.stringify({ ...DEFAULT_CHAOS_SETTINGS, latencyMs: 800, errorRate: 0.2 }))
    const chaos = createStoredChaosController(storage)
    expect(chaos.getSettings()).toMatchObject({ latencyMs: 800, errorRate: 0.2 })
    chaos.reset()
    expect(chaos.getSettings()).toEqual(DEFAULT_CHAOS_SETTINGS)
  })

  it('counts a slow network on the badge', () => {
    const chaos = createChaosController()
    chaos.update({ latencyMs: 10_000 })
    renderControls({ chaos, resetData: vi.fn() })
    expect(screen.getByRole('button', { name: 'Mock API, 1 setting simulating failures' })).toBeInTheDocument()
  })

  it('a preset stops showing as selected once any setting is moved away from it', async () => {
    const chaos = createChaosController()
    const { user } = renderControls({ chaos, resetData: vi.fn() })
    const panel = await openPanel(user)
    await user.click(within(panel).getByRole('button', { name: 'Flaky' }))
    fireEvent.change(within(panel).getByRole('slider', { name: 'Failures after money is sent' }), { target: { value: '0.9' } })
    for (const name of ['Instant', 'Normal', 'Slow network', 'Flaky']) {
      expect(within(panel).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('shows and keeps a delay set above 10 seconds', async () => {
    const chaos = createChaosController()
    chaos.update({ latencyMs: 20_000 })
    const { user } = renderControls({ chaos, resetData: vi.fn() })
    const panel = await openPanel(user)
    const delay = within(panel).getByRole('slider', { name: 'Delay' })
    expect(delay).toHaveValue('20000')
    expect(delay).toHaveAttribute('aria-valuetext', '20,000 ms')
  })

  it('says the app\'s real timeout, not a copy of it', async () => {
    const { user } = renderControls()
    const panel = await openPanel(user)
    expect(within(panel).getByText(new RegExp(`the app stops waiting after ${DEFAULT_HTTP_CONFIG.timeoutMs / 1000}s`))).toBeInTheDocument()
  })

  it('closes the reset confirmation when the panel closes, and marks the delete as destructive', async () => {
    const { user } = renderControls()
    let panel = await openPanel(user)
    await user.click(within(panel).getByRole('button', { name: 'Reset demo data…' }))
    expect(within(panel).getByRole('button', { name: 'Delete and reload' }).className).toContain('bg-danger')
    await user.click(within(panel).getByRole('button', { name: 'Close Mock API controls' }))
    panel = await openPanel(user)
    expect(within(panel).getByRole('button', { name: 'Reset demo data…' })).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Delete and reload' })).not.toBeInTheDocument()
  })

  it('a watcher that throws does not break the request being decided', () => {
    const chaos = createChaosController({ random: () => 0.99, sleep: () => Promise.resolve() })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    chaos.subscribe(() => { throw new Error('broken watcher') })
    chaos.forceNextTransfer('success')
    expect(() => chaos.decide(true)).not.toThrow()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
