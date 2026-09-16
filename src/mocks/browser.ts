/**
 * Starts the mock API in the browser as a service worker (ADR-0005). Loaded lazily from main.tsx, so
 * a build with VITE_USE_MOCK=false does not download MSW or the seed data.
 */
import { setupWorker } from 'msw/browser'
import { createMockDb } from './db'
import { createHandlers } from './handlers'

export async function startMockApi(): Promise<void> {
  const worker = setupWorker(...createHandlers(createMockDb({ now: () => new Date() })))
  await worker.start({
    // Only API calls are mocked; the app's own assets, fonts and HMR pass through untouched.
    onUnhandledRequest: 'bypass',
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    quiet: import.meta.env.PROD,
  })
}
