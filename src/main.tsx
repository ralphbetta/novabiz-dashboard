import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

/**
 * The mock API must be running before the first render, or the first requests race the worker and
 * fail. It runs in every build unless explicitly disabled, because there is no real backend (ADR-0005).
 */
async function enableMockApi(): Promise<void> {
  if (import.meta.env.VITE_USE_MOCK === 'false') return
  const { startMockApi } = await import('./mocks/browser')
  await startMockApi()
}

/** Matches the request timeout in ADR-0014. A hung worker registration must not leave a blank page. */
const STARTUP_TIMEOUT_MS = 15_000

class StartupTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new StartupTimeoutError()), ms)),
  ])
}

function renderApp(root: HTMLElement): void {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

/**
 * Shown when the mock cannot start. The usual cause is an insecure context: service workers only
 * register on https:// or localhost, so opening the dev server via a LAN IP fails here. Said plainly,
 * rather than letting every request fail and presenting it as a network error.
 */
function renderStartupFailure(root: HTMLElement, error: unknown): void {
  console.error('Mock API failed to start', error)
  const message = document.createElement('p')
  message.setAttribute('role', 'alert')
  message.textContent = !window.isSecureContext
    ? 'This app must be opened over https:// or on localhost. Its data service cannot start on an insecure address.'
    : error instanceof StartupTimeoutError
      ? 'The app is taking too long to start. Check your connection, then reload the page.'
      : 'The app could not start its data service. Reload the page to try again.'
  root.replaceChildren(message)
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element in index.html')

withTimeout(enableMockApi(), STARTUP_TIMEOUT_MS).then(
  () => renderApp(root),
  (error: unknown) => renderStartupFailure(root, error),
)
