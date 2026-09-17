/**
 * Chaos controls for the mock API (ADR-0005): make it slow, make it fail, make it go silent.
 *
 * The brief asks for "simulated latency and a configurable failure rate so you can actually test your
 * error states". A plain "fail 10% of requests" is not enough for this app. ADR-0006 turns on a
 * distinction a failure rate cannot express: whether the error happens BEFORE or AFTER the transfer is
 * written. An error before commit means nothing moved. A timeout after commit means money moved and
 * the client was never told — the case reconciliation exists for. So every injected failure has a
 * commit point.
 *
 * Framework-free: handlers.ts applies the decisions. Randomness and sleeping are injectable, so tests
 * are deterministic and never actually wait.
 */
import { z } from 'zod'
import type { TransactionWire } from '../api/contracts'
import type { SettlementOutcome } from './db'

/** Strict: an unknown key throws. Settings are typed by hand in the browser console, where a typo like
 * `latency` for `latencyMs` would otherwise be dropped silently and change nothing. */
export const ChaosSettingsSchema = z.strictObject({
  /** Added to every request before it is processed. */
  latencyMs: z.int().min(0).max(30_000),
  /** A further uniformly random 0..jitterMs, so requests don't all resolve in lockstep. */
  jitterMs: z.int().min(0).max(30_000),
  /** Probability a request is answered with 500 INTERNAL_ERROR. */
  errorRate: z.number().min(0).max(1),
  /** Probability a request is never answered at all. The client's own timeout must end it. */
  timeoutRate: z.number().min(0).max(1),
  /**
   * For injected errors and timeouts on a transfer POST: the probability the failure happens AFTER the
   * transfer was written. 0 means injected failures never move money; 1 means they always do.
   */
  afterCommitRate: z.number().min(0).max(1),
  /** Probability an accepted transfer later fails to settle. */
  settlementFailureRate: z.number().min(0).max(1),
})
export type ChaosSettings = z.output<typeof ChaosSettingsSchema>

export const DEFAULT_CHAOS_SETTINGS: ChaosSettings = {
  latencyMs: 400,
  jitterMs: 300,
  errorRate: 0,
  timeoutRate: 0,
  afterCommitRate: 0.5,
  settlementFailureRate: 0,
}

/**
 * A deterministic outcome for the NEXT transfer POST, consumed once. Random rates cannot be
 * demonstrated on demand; "the next transfer will time out after it goes through" can.
 */
export const ForcedTransferOutcomeSchema = z.enum([
  'success',
  'error-before-commit',
  'error-after-commit',
  'timeout-before-commit',
  'timeout-after-commit',
])
export type ForcedTransferOutcome = z.output<typeof ForcedTransferOutcomeSchema>

export const ForcedSettlementSchema = z.enum(['successful', 'failed'])
export type ForcedSettlement = z.output<typeof ForcedSettlementSchema>

/** An injected failure, and whether it happens before or after the transfer is written. */
export interface ChaosFailure {
  kind: 'error' | 'timeout'
  when: 'before-commit' | 'after-commit'
}

/** What handlers.ts must do with one request. */
export interface ChaosDecision {
  delayMs: number
  failure: ChaosFailure | null
  /** Drawn for every request, used only if it creates a transfer. See `decide`. */
  settlementRoll: number
}

const FORCED_FAILURES = {
  'error-before-commit': { kind: 'error', when: 'before-commit' },
  'error-after-commit': { kind: 'error', when: 'after-commit' },
  'timeout-before-commit': { kind: 'timeout', when: 'before-commit' },
  'timeout-after-commit': { kind: 'timeout', when: 'after-commit' },
} as const satisfies Record<Exclude<ForcedTransferOutcome, 'success'>, ChaosFailure>

/**
 * How long a simulated timeout holds its response before releasing it: far past the client's 15s request
 * timeout (ADR-0014), so the client has long given up. Finite on purpose. A service-worker fetch event
 * that never settles can get the worker terminated by the browser, and MSW's worker then forgets its
 * clients and passes every request to the real network — the mock would silently switch off.
 */
export const TIMEOUT_HOLD_MS = 60_000

export const SIMULATED_SETTLEMENT_FAILURE_REASON = 'Beneficiary bank unavailable (simulated)'

/** Random rolls `decide` draws for every request, whatever happens to it. Tests build roll sequences from it. */
export const ROLLS_PER_REQUEST = 5

export interface ChaosOptions {
  settings?: Partial<ChaosSettings>
  random?: () => number
  sleep?: (ms: number) => Promise<void>
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function createChaosController({ settings: initial = {}, random = Math.random, sleep = realSleep }: ChaosOptions = {}) {
  const initialSettings = ChaosSettingsSchema.parse({ ...DEFAULT_CHAOS_SETTINGS, ...initial })
  let settings = { ...initialSettings }
  let forcedTransfer: ForcedTransferOutcome | null = null
  let forcedSettlement: ForcedSettlement | null = null
  /** Transfer id -> settlement decided when it was created, so "the next transfer" means exactly that. */
  const settlementByTransferId = new Map<string, 'successful' | 'failed'>()

  /**
   * For watchers such as the Mock API panel: one snapshot object between changes (as `useSyncExternalStore` needs), and
   * a notification whenever the settings or an armed outcome change — including when a request uses one up.
   */
  type Snapshot = { settings: ChaosSettings; forced: { transfer: ForcedTransferOutcome | null; settlement: ForcedSettlement | null } }
  const listeners = new Set<() => void>()
  const takeSnapshot = (): Snapshot => ({ settings: { ...settings }, forced: { transfer: forcedTransfer, settlement: forcedSettlement } })
  let snapshot = takeSnapshot()
  const changed = () => {
    const next = takeSnapshot()
    if (JSON.stringify(next) === JSON.stringify(snapshot)) return
    snapshot = next
    for (const listener of listeners) {
      // A watcher is the panel, not the mock. One that throws must not fail the request being decided.
      try {
        listener()
      } catch (error) {
        console.error('[mock api] a chaos watcher threw', error)
      }
    }
  }

  return {
    getSettings: (): ChaosSettings => ({ ...settings }),

    getSnapshot: (): Snapshot => snapshot,

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },

    /** Merge and validate. Throws on out-of-range values or unknown keys, rather than clamping or ignoring them. */
    update(partial: Partial<ChaosSettings>): ChaosSettings {
      settings = ChaosSettingsSchema.parse({ ...settings, ...partial })
      changed()
      return { ...settings }
    },

    /**
     * Restores the settings this controller was created with — DEFAULT_CHAOS_SETTINGS plus any overrides
     * passed in — and clears anything forced. A test that builds a controller with custom settings gets
     * those back, not the global defaults. Settlements already fixed for existing transfers are kept:
     * they were decided when those transfers were created.
     */
    reset(): void {
      settings = { ...initialSettings }
      forcedTransfer = null
      forcedSettlement = null
      changed()
    },

    /**
     * Force the outcome of the next transfer POST. Pass null to cancel. `success` and the before-commit
     * outcomes are used by the next POST, whatever the db does with it — nothing moves either way. An
     * after-commit outcome stays armed until a POST actually creates a transfer, so a replay or a
     * transfer the db rejects cannot use it up without money moving. While it is armed, the random rates
     * still apply to other POSTs: a random before-commit failure stops a POST reaching the db, and the
     * outcome stays armed for the next one that does.
     */
    forceNextTransfer(outcome: ForcedTransferOutcome | null): void {
      forcedTransfer = outcome === null ? null : ForcedTransferOutcomeSchema.parse(outcome)
      changed()
    },

    /** Force whether the next transfer created will settle successfully or fail. Pass null to cancel. */
    forceNextSettlement(outcome: ForcedSettlement | null): void {
      forcedSettlement = outcome === null ? null : ForcedSettlementSchema.parse(outcome)
      changed()
    },

    getForced: () => ({ transfer: forcedTransfer, settlement: forcedSettlement }),

    sleep,

    /**
     * Decide what happens to one request, before the db is called. Forced transfer outcomes are used only
     * by a transfer POST, so balance, feed and status requests polled in between cannot use them up.
     */
    decide(isTransferWrite: boolean): ChaosDecision {
      // Exactly five rolls, on every request — read or write, forced or not, whether or not it goes on
      // to create a transfer. The settlement roll is drawn here rather than when a transfer is created,
      // because otherwise a POST that creates nothing (a replay, a db rejection, a before-commit failure)
      // would draw one roll fewer. With a seeded random source, nothing about one request can then shift
      // which later requests the rates hit.
      const jitterRoll = random()
      const timeoutRoll = random()
      const errorRoll = random()
      const commitRoll = random()
      const settlementRoll = random()
      const delayMs = settings.latencyMs + Math.floor(jitterRoll * (settings.jitterMs + 1))

      const forced = isTransferWrite ? forcedTransfer : null
      if (forced === 'success') {
        forcedTransfer = null
        changed()
        return { delayMs, failure: null, settlementRoll }
      }
      if (forced !== null && FORCED_FAILURES[forced].when === 'before-commit') {
        forcedTransfer = null
        changed()
        return { delayMs, failure: FORCED_FAILURES[forced], settlementRoll }
      }
      // No forced outcome, or a forced after-commit outcome that stays armed: the random rates apply. An
      // armed after-commit outcome is claimed in onTransferCreated, and takes precedence there.

      const kind = timeoutRoll < settings.timeoutRate ? 'timeout' : errorRoll < settings.errorRate ? 'error' : null
      if (kind === null) return { delayMs, failure: null, settlementRoll }
      // A read writes nothing, so for reads every failure is "before commit".
      const when = isTransferWrite && commitRoll < settings.afterCommitRate ? 'after-commit' : 'before-commit'
      return { delayMs, failure: { kind, when }, settlementRoll }
    },

    /**
     * Called once when a transfer is newly created (not replayed), with the settlement roll `decide` drew
     * for this request. Fixes the transfer's future settlement, and claims a forced after-commit outcome
     * if one is armed: that failure is returned for the handler to apply, and is consumed only here, by a
     * request that really moved money.
     */
    onTransferCreated(transferId: string, settlementRoll: number): ChaosFailure | null {
      const outcome = forcedSettlement ?? (settlementRoll < settings.settlementFailureRate ? 'failed' : 'successful')
      forcedSettlement = null
      settlementByTransferId.set(transferId, outcome)

      const forced = forcedTransfer
      if (forced === null || forced === 'success' || FORCED_FAILURES[forced].when !== 'after-commit') {
        changed()
        return null
      }
      forcedTransfer = null
      changed()
      return FORCED_FAILURES[forced]
    },

    /** The db's settlement hook. */
    settlementOutcome(transfer: TransactionWire): SettlementOutcome {
      const outcome = settlementByTransferId.get(transfer.id) ?? 'successful'
      settlementByTransferId.delete(transfer.id)
      return outcome === 'failed' ? { status: 'failed', reason: SIMULATED_SETTLEMENT_FAILURE_REASON } : { status: 'successful' }
    },
  }
}

export type ChaosController = ReturnType<typeof createChaosController>
