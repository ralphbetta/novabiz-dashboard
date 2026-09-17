import { useId, useRef, useState, type ReactNode } from 'react'
import { DEFAULT_HTTP_CONFIG } from '../../api/baseQuery'
import { DEFAULT_CHAOS_SETTINGS, TIMEOUT_HOLD_MS, type ChaosSettings } from '../../mocks/chaos'
import { useAnnounce } from '../../components/feedback/announcerContext'
import { Button, IconButton } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { useChaosState, useMockControls, type MockControls } from './mockControlsContext'
import { PRESETS, SETTLEMENT_OUTCOMES, TRANSFER_OUTCOMES, activeCount, matchesPreset } from './options'

/**
 * The "Mock API" button in the top bar and the panel it opens (ADR-0005). There is no real backend, so the badge says
 * so on every page, and the panel lets a reviewer make the next transfer fail in a chosen way without the console.
 *
 * Renders nothing until the mock has started, and nothing in a build without it.
 */
export function MockApiControls() {
  const controls = useMockControls()
  if (!controls) return null
  return <MockApiControlsFor controls={controls} />
}

function MockApiControlsFor({ controls }: { controls: MockControls }) {
  const dialog = useRef<HTMLDialogElement>(null)
  // The panel's contents exist only while it is open, so closing it also forgets a half-finished confirmation.
  const [isOpen, setIsOpen] = useState(false)
  const state = useChaosState(controls)
  const active = activeCount(state)
  const titleId = useId()

  const open = () => {
    const element = dialog.current
    if (!element) return
    setIsOpen(true)
    if (typeof element.showModal === 'function') element.showModal()
    else element.setAttribute('open', '')
  }
  const close = () => {
    const element = dialog.current
    setIsOpen(false)
    if (!element) return
    if (typeof element.close === 'function') element.close()
    else element.removeAttribute('open')
  }

  return (
    <>
      <Button
        onClick={open}
        aria-haspopup="dialog"
        // One explicit name: text split across the label and the count is joined unpredictably by screen readers.
        aria-label={active > 0 ? `Mock API, ${active} ${active === 1 ? 'setting' : 'settings'} simulating failures` : 'Mock API'}
        className="px-3"
      >
        <Icon name="sliders" className="hidden size-4 text-fg-muted sm:block" />
        {/* Short on phones, where the top bar is narrow: no icon, one word. The accessible name comes from aria-label. */}
        <span aria-hidden="true" className="sm:hidden">Mock</span>
        <span aria-hidden="true" className="hidden sm:inline">Mock API</span>
        {active > 0 ? (
          <span aria-hidden="true" className="grid min-w-5 place-items-center rounded-full bg-pending-subtle px-1.5 text-xs font-semibold text-pending">
            {active}
          </span>
        ) : null}
      </Button>

      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => setIsOpen(false)}
        className="m-0 ml-auto h-dvh max-h-none w-full max-w-md bg-surface p-0 text-fg backdrop:bg-fg/50"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 id={titleId} className="text-lg font-semibold">Mock API controls</h2>
              <p className="mt-0.5 text-sm text-fg-muted">A simulated bank server. Changes apply to the next requests.</p>
            </div>
            <IconButton label="Close Mock API controls" onClick={close} className="-mr-2">
              <Icon name="x" />
            </IconButton>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-5">
            {isOpen ? <MockControlsPanel controls={controls} /> : null}
          </div>
        </div>
      </dialog>
    </>
  )
}

/** The panel's contents. Exported for tests; the app uses MockApiControls. */
export function MockControlsPanel({ controls }: { controls: MockControls }) {
  const { chaos, resetData } = controls
  const { settings, forced } = useChaosState(controls)
  const announce = useAnnounce()
  const [confirmingReset, setConfirmingReset] = useState(false)
  const set = (partial: Partial<ChaosSettings>) => { chaos.update(partial) }

  return (
    <div className="flex flex-col gap-7">
      <ChoiceGroup
        legend="Next transfer"
        hint={forced.transfer ? 'Armed: used by the next transfer you send.' : undefined}
        options={TRANSFER_OUTCOMES}
        value={forced.transfer}
        onChange={(value) => chaos.forceNextTransfer(value)}
      />
      <p className="-mt-5 text-xs text-fg-muted">
        A timeout holds the reply for {TIMEOUT_HOLD_MS / 1000}s; the app stops waiting after {DEFAULT_HTTP_CONFIG.timeoutMs / 1000}s and
        starts confirming.
      </p>

      <ChoiceGroup
        legend="Next settlement"
        hint={forced.settlement ? 'Armed: used by the next transfer the bank accepts.' : undefined}
        options={SETTLEMENT_OUTCOMES}
        value={forced.settlement}
        onChange={(value) => chaos.forceNextSettlement(value)}
      />

      <section aria-labelledby="mock-network-heading">
        <h3 id="mock-network-heading" className="text-sm font-semibold">Network</h3>
        <div role="group" aria-label="Presets" className="mt-3 grid grid-cols-2 gap-2">
          {PRESETS.map((preset) => {
            const selected = matchesPreset(settings, preset.settings)
            return (
              <button
                key={preset.name}
                type="button"
                aria-pressed={selected}
                onClick={() => { set(preset.settings); announce(`${preset.name} network applied`) }}
                className={`min-h-11 rounded-xl border px-3 text-sm font-semibold ${selected ? 'border-accent bg-surface-muted text-accent' : 'border-border text-fg hover:border-border-strong hover:bg-surface-muted'}`}
              >
                {preset.name}
              </button>
            )
          })}
        </div>
        <div className="mt-5 flex flex-col gap-4">
          <Slider label="Delay" value={settings.latencyMs} min={0} max={30_000} step={100} format={(v) => `${v.toLocaleString('en-NG')} ms`} onChange={(v) => set({ latencyMs: v })} />
          <Slider label="Jitter" value={settings.jitterMs} min={0} max={30_000} step={100} format={(v) => `up to ${v.toLocaleString('en-NG')} ms`} onChange={(v) => set({ jitterMs: v })} />
          <Slider label="Error rate" value={settings.errorRate} min={0} max={1} step={0.05} format={percent} onChange={(v) => set({ errorRate: v })} />
          <Slider label="Timeout rate" value={settings.timeoutRate} min={0} max={1} step={0.05} format={percent} onChange={(v) => set({ timeoutRate: v })} />
          <Slider
            label="Failures after money is sent"
            hint="Of the random errors and timeouts on transfers, the share that happen after the transfer is written."
            value={settings.afterCommitRate} min={0} max={1} step={0.05} format={percent} onChange={(v) => set({ afterCommitRate: v })}
          />
          <Slider label="Settlement failure rate" value={settings.settlementFailureRate} min={0} max={1} step={0.05} format={percent} onChange={(v) => set({ settlementFailureRate: v })} />
        </div>
      </section>

      <section aria-labelledby="mock-data-heading" className="border-t border-border pt-6">
        <h3 id="mock-data-heading" className="text-sm font-semibold">Demo data</h3>
        <p className="mt-1 text-sm text-fg-muted">Transfers you make are saved in this browser and kept after a reload.</p>
        {confirmingReset ? (
          <div className="mt-3 rounded-2xl bg-danger-subtle p-4 text-sm text-danger">
            <p className="font-semibold">Delete every transfer you made and start again from the original data? The page will reload.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => setConfirmingReset(false)} autoFocus>Cancel</Button>
              <Button variant="danger" onClick={resetData}>Delete and reload</Button>
            </div>
          </div>
        ) : (
          <Button onClick={() => setConfirmingReset(true)} className="mt-3">Reset demo data…</Button>
        )}
      </section>

      <div className="border-t border-border pt-6">
        <Button
          onClick={() => {
            chaos.update(DEFAULT_CHAOS_SETTINGS)
            chaos.forceNextTransfer(null)
            chaos.forceNextSettlement(null)
            announce('Mock API controls reset')
          }}
        >
          Reset controls
        </Button>
      </div>
    </div>
  )
}

const percentFormat = new Intl.NumberFormat('en-NG', { style: 'percent', maximumFractionDigits: 0 })
const percent = (value: number) => percentFormat.format(value)

function ChoiceGroup<T extends string>({ legend, hint, options, value, onChange }: {
  legend: string
  hint: ReactNode
  options: { value: T | null; label: string; description: string }[]
  value: T | null
  onChange: (value: T | null) => void
}) {
  const name = useId()
  return (
    <fieldset>
      <legend className="text-sm font-semibold">{legend}</legend>
      {hint ? <p className="mt-1 text-xs font-semibold text-pending">{hint}</p> : null}
      <div className="mt-3 flex flex-col gap-2">
        {options.map((option) => {
          const id = `${name}-${option.value ?? 'none'}`
          return (
            <label key={id} htmlFor={id} className="relative block cursor-pointer">
              <input
                id={id}
                type="radio"
                name={name}
                className="peer sr-only"
                checked={value === option.value}
                onChange={() => onChange(option.value)}
                aria-describedby={`${id}-description`}
              />
              <span className="flex flex-col rounded-xl border border-border px-3 py-2.5 peer-checked:border-accent peer-checked:bg-surface-muted peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus hover:border-border-strong">
                <span className="text-sm font-semibold">{option.label}</span>
                <span id={`${id}-description`} className="text-xs text-fg-muted">{option.description}</span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

function Slider({ label, hint, value, min, max, step, format, onChange }: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  format: (value: number) => string
  onChange: (value: number) => void
}) {
  const id = useId()
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        <output htmlFor={id} className="text-sm text-fg-muted tabular-nums">{format(value)}</output>
      </div>
      {hint ? <p id={`${id}-hint`} className="text-xs text-fg-muted">{hint}</p> : null}
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={format(value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 h-11 w-full cursor-pointer accent-accent"
      />
    </div>
  )
}
