/**
 * Starts the mock API in the browser as a service worker (ADR-0005). Loaded lazily from main.tsx, so
 * a build with VITE_USE_MOCK=false does not download MSW or the seed data.
 */
import { setupWorker } from 'msw/browser'
import { createChaosController, type ChaosController } from './chaos'
import { createMockDb } from './db'
import { createHandlers } from './handlers'

declare global {
  interface Window {
    /**
     * The mock API's chaos controls, exposed while the mock is running. Until the chaos panel exists
     * (after Phase 3), this is how to trigger failure modes from the browser console. Playwright uses it
     * too. For example:
     *   novabizChaos.forceNextTransfer('timeout-after-commit')
     *   novabizChaos.update({ errorRate: 0.2, latencyMs: 1500 })
     */
    novabizChaos?: ChaosController
  }
}

export async function startMockApi(): Promise<ChaosController> {
  const chaos = createChaosController()
  const db = createMockDb({ now: () => new Date(), settlementOutcome: chaos.settlementOutcome })
  const worker = setupWorker(...createHandlers(db, { chaos }))
  await worker.start({
    // Only API calls are mocked; the app's own assets, fonts and HMR pass through untouched.
    onUnhandledRequest: 'bypass',
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    quiet: import.meta.env.PROD,
  })
  window.novabizChaos = chaos
  return chaos
}
