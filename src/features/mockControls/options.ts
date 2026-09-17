import { DEFAULT_CHAOS_SETTINGS, type ChaosSettings, type ForcedSettlement, type ForcedTransferOutcome } from '../../mocks/chaos'

/**
 * The next-transfer outcomes, in the merchant's terms. "Money sent" and "nothing sent" name the commit point that
 * ADR-0006 turns on: whether the transfer was written before the failure.
 */
export const TRANSFER_OUTCOMES: { value: ForcedTransferOutcome | null; label: string; description: string }[] = [
  { value: null, label: 'Nothing forced', description: 'The next transfer follows the network settings below.' },
  { value: 'success', label: 'Succeeds', description: 'Goes through and replies normally, whatever the settings below.' },
  { value: 'error-before-commit', label: 'Error, nothing sent', description: 'Fails with a server error before anything is written.' },
  { value: 'error-after-commit', label: 'Error, money sent', description: 'Goes through, then replies with a server error.' },
  { value: 'timeout-before-commit', label: 'Timeout, nothing sent', description: 'Never replies, and nothing is written.' },
  { value: 'timeout-after-commit', label: 'Timeout, money sent', description: 'Goes through, but the reply never arrives. The case reconciliation exists for.' },
]

export const SETTLEMENT_OUTCOMES: { value: ForcedSettlement | null; label: string; description: string }[] = [
  { value: null, label: 'Nothing forced', description: 'Settles as the failure rate below decides.' },
  { value: 'successful', label: 'Settles', description: 'The bank completes it.' },
  { value: 'failed', label: 'Fails to settle', description: 'Accepted, then fails; the money is returned.' },
]

/** Complete settings, so a preset shows as selected only when every setting matches it. */
export const PRESETS: { name: string; settings: ChaosSettings }[] = [
  { name: 'Instant', settings: { ...DEFAULT_CHAOS_SETTINGS, latencyMs: 0, jitterMs: 0 } },
  { name: 'Normal', settings: DEFAULT_CHAOS_SETTINGS },
  { name: 'Slow network', settings: { ...DEFAULT_CHAOS_SETTINGS, latencyMs: 2_500, jitterMs: 1_500 } },
  { name: 'Flaky', settings: { ...DEFAULT_CHAOS_SETTINGS, latencyMs: 800, jitterMs: 800, errorRate: 0.2, timeoutRate: 0.05, settlementFailureRate: 0.1 } },
]

/** Whether the current settings match a preset, so its button can show as selected. */
export function matchesPreset(current: ChaosSettings, preset: Partial<ChaosSettings>): boolean {
  return (Object.keys(preset) as (keyof ChaosSettings)[]).every((key) => current[key] === preset[key])
}

/**
 * What differs from a plain, reliable server: shown on the top-bar button so a forced, flaky or slow setup is never
 * hidden. A network slower than the default counts: a saved 10-second delay otherwise just feels like a broken app.
 */
export function activeCount(state: { settings: ChaosSettings; forced: { transfer: unknown; settlement: unknown } }): number {
  const { settings, forced } = state
  const slow = settings.latencyMs > DEFAULT_CHAOS_SETTINGS.latencyMs || settings.jitterMs > DEFAULT_CHAOS_SETTINGS.jitterMs
  return [forced.transfer !== null, forced.settlement !== null, slow, settings.errorRate > 0, settings.timeoutRate > 0, settings.settlementFailureRate > 0]
    .filter(Boolean).length
}
