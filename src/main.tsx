import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { setupListeners } from '@reduxjs/toolkit/query'
import './index.css'
import App from './App.tsx'
import { makeStore } from './store'
import { STARTUP_SLOW_MS, startupMessage, type StartupProblem } from './app/startup'

/** Starts the mock API unless explicitly disabled. There is no real backend (ADR-0005). */
async function startDataService(): Promise<void> {
  if (import.meta.env.VITE_USE_MOCK === 'false') return
  const { startMockApi } = await import('./mocks/browser')
  await startMockApi()
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
const serviceReady = startDataService()
const slowNotice = setTimeout(() => setStartupAlert('slow'), STARTUP_SLOW_MS)
serviceReady.then(
  () => { clearTimeout(slowNotice); setStartupAlert(null) },
  (error: unknown) => { clearTimeout(slowNotice); console.error('Data service failed to start', error); setStartupAlert('failed') },
)

const store = makeStore({ serviceReady })
// Enables refetchOnReconnect (ADR-0003). refetchOnFocus is off in the API slice.
setupListeners(store.dispatch)

createRoot(root).render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>,
)
