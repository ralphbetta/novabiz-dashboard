/**
 * Starts the mock API in the browser as a service worker (ADR-0005). Loaded lazily from main.tsx, so
 * a build with VITE_USE_MOCK=false does not download MSW or the seed data.
 */
import { setupWorker } from 'msw/browser'
import type { ChaosController } from './chaos'
import { createMockDb } from './db'
import { createHandlers } from './handlers'
import { createMockPersistence, loadMockDbSnapshot } from './persistence'
import { createStoredChaosController } from './chaosSettingsStorage'

declare global {
  interface Window {
    /**
     * The mock API's chaos controls, exposed while the mock is running — the same controls as the "Mock API" panel in
     * the top bar, for the browser console and Playwright. For example:
     *   novabizChaos.forceNextTransfer('timeout-after-commit')
     *   novabizChaos.update({ errorRate: 0.2, latencyMs: 1500 })
     */
    novabizChaos?: ChaosController
    /** The mock's saved data. `novabizMock.resetData()` clears it and reloads with fresh seed data. */
    novabizMock?: { resetData: () => void }
  }
}

function browserStorage(kind: 'localStorage' | 'sessionStorage'): Storage | undefined {
  try {
    return window[kind]
  } catch {
    return undefined
  }
}

/** What the Mock API panel works with: the chaos controls, and wiping the saved data. */
export interface MockControls {
  chaos: ChaosController
  resetData: () => void
}

export async function startMockApi(): Promise<MockControls> {
  const storage = browserStorage('localStorage')
  // The panel's settings from last time, if any; reset() still restores the defaults (chaosSettingsStorage.ts).
  const chaos = createStoredChaosController(storage)
  // The saved database, so transfers and their idempotency records survive a reload (persistence.ts).
  const snapshot = loadMockDbSnapshot(storage)
  const db = createMockDb({ now: () => new Date(), settlementOutcome: chaos.settlementOutcome, ...(snapshot ? { snapshot } : {}) })
  const persistence = createMockPersistence({ local: storage, session: browserStorage('sessionStorage'), snapshot: () => db.snapshot() })
  persistence.save()
  const worker = setupWorker(...createHandlers(db, { chaos, afterProcessing: persistence.afterProcessing }))
  await worker.start({
    // Only API calls are mocked; the app's own assets, fonts and HMR pass through untouched.
    onUnhandledRequest: 'bypass',
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    quiet: import.meta.env.PROD,
  })
  // A pending save is written before the page goes away.
  window.addEventListener('pagehide', persistence.save)
  const resetData = () => {
    persistence.reset()
    window.location.reload()
  }
  window.novabizChaos = chaos
  window.novabizMock = { resetData }
  return { chaos, resetData }
}
