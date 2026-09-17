/**
 * The chaos controller can be watched, so the Mock API panel shows what is armed — including when a request uses an
 * armed outcome up.
 */
import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_CHAOS_SETTINGS, createChaosController } from './chaos'

describe('watching the chaos controller', () => {
  it('notifies on every change a person makes, and keeps one snapshot object between changes', () => {
    const chaos = createChaosController({ random: () => 0.99, sleep: () => Promise.resolve() })
    const listener = vi.fn()
    const unsubscribe = chaos.subscribe(listener)

    const first = chaos.getSnapshot()
    expect(chaos.getSnapshot()).toBe(first)
    expect(first).toEqual({ settings: DEFAULT_CHAOS_SETTINGS, forced: { transfer: null, settlement: null } })

    chaos.update({ latencyMs: 2_000 })
    chaos.forceNextTransfer('timeout-after-commit')
    chaos.forceNextSettlement('failed')
    chaos.reset()
    expect(listener).toHaveBeenCalledTimes(4)
    expect(chaos.getSnapshot()).not.toBe(first)
    expect(chaos.getSnapshot()).toEqual(first)

    unsubscribe()
    chaos.update({ latencyMs: 1 })
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('notifies when a request uses up an armed outcome', () => {
    const chaos = createChaosController({ random: () => 0.99, sleep: () => Promise.resolve() })
    chaos.forceNextTransfer('error-before-commit')
    chaos.forceNextSettlement('failed')
    const listener = vi.fn()
    chaos.subscribe(listener)

    chaos.decide(false) // a read never uses it
    expect(listener).not.toHaveBeenCalled()
    chaos.decide(true) // the transfer POST does
    expect(listener).toHaveBeenCalledOnce()
    expect(chaos.getSnapshot().forced.transfer).toBeNull()

    chaos.onTransferCreated('txn_1', 0.5) // the settlement is used by the next transfer created
    expect(listener).toHaveBeenCalledTimes(2)
    expect(chaos.getSnapshot().forced.settlement).toBeNull()
  })

  it('does not notify when nothing changed', () => {
    const chaos = createChaosController({ random: () => 0.99, sleep: () => Promise.resolve() })
    const listener = vi.fn()
    chaos.subscribe(listener)
    chaos.decide(true)
    chaos.onTransferCreated('txn_1', 0.5)
    chaos.update({})
    chaos.forceNextTransfer(null)
    expect(listener).not.toHaveBeenCalled()
  })
})
