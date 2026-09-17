import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { setupListeners } from '@reduxjs/toolkit/query'
import './styles/index.css'
import App from './app/App'
import { makeStore } from './store'
import { persistOpenTransferKey, readOpenTransferKey } from './store/openTransferKey'
import { transferDraft } from './store/transferDraftSlice'
import { IdempotencyKeySchema } from './api/contracts'
import { STARTUP_SLOW_MS, startupMessage, type StartupProblem } from './app/startup'
import { MockControlsProvider } from './features/mockControls/MockControlsProvider'
import type { MockControls } from './features/mockControls/mockControlsContext'

/**
 * Starts the mock API unless explicitly disabled. There is no real backend (ADR-0005). Resolves to the mock's controls,
 * for the Mock API panel, or null when there is no mock.
 */
async function startDataService(): Promise<MockControls | null> {
  if (import.meta.env.VITE_USE_MOCK === 'false') return null
  const { startMockApi } = await import('./mocks/browser')
  return startMockApi()
}

/**
 * #startup-alert is a live region in index.html, outside React's root and present from first paint, so a
 * message written to it is announced. The usual cause of a real failure is an insecure context: service
 * workers only register on https:// or localhost, so opening the dev server via a LAN IP fails.
 */
function setStartupAlert(problem: StartupProblem | null): void {
  const alert = document.getElementById('startup-alert')
  if (alert) alert.textContent = problem === null ? '' : startupMessage(problem, window.isSecureContext)
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element in index.html')

// Render at once rather than waiting for the mock API: requests wait for `serviceReady` inside the base query,
// for a bounded time each, so screens show their own loading states meanwhile.
const mockControls = startDataService()
const serviceReady = mockControls.then(() => undefined)
const slowNotice = setTimeout(() => setStartupAlert('slow'), STARTUP_SLOW_MS)
serviceReady.then(
  () => { clearTimeout(slowNotice); setStartupAlert(null) },
  (error: unknown) => { clearTimeout(slowNotice); console.error('Data service failed to start', error); setStartupAlert('failed') },
)

const store = makeStore({ serviceReady })
// Enables refetchOnReconnect (ADR-0003), and the online/visibility actions the transfer tracker pauses on.
setupListeners(store.dispatch)

// A transfer whose outcome was still open when the page went away: check it again (ADR-0004, ADR-0006). The stored
// value is untrusted input, so only a well-formed key is used.
const sessionStore = (() => { try { return window.sessionStorage } catch { return undefined } })()
const restoredKey = IdempotencyKeySchema.safeParse(readOpenTransferKey(sessionStore))
persistOpenTransferKey(store, sessionStore)
if (restoredKey.success) store.dispatch(transferDraft.attemptRestored({ idempotencyKey: restoredKey.data }))

createRoot(root).render(
  <StrictMode>
    <Provider store={store}>
      <MockControlsProvider controls={mockControls}>
        <App />
      </MockControlsProvider>
    </Provider>
  </StrictMode>,
)
