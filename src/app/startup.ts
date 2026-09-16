/**
 * What the merchant is told while the data service starts, or if it cannot.
 *
 * A slow start is not treated as a failure. Each request waits a bounded time for the service and is refused
 * unsent if it is not ready (baseQuery.ts), but the service itself keeps starting, and requests made once it is
 * up succeed. So after STARTUP_SLOW_MS the message says it is slow, and it is cleared if the service then comes
 * up. Only a real startup failure — the worker refusing to register — is final and asks for a reload.
 */

/** Matches the request timeout in ADR-0014. */
export const STARTUP_SLOW_MS = 15_000

export type StartupProblem = 'slow' | 'failed'

export function startupMessage(problem: StartupProblem, isSecureContext: boolean): string {
  if (!isSecureContext) {
    return 'This app must be opened over https:// or on localhost. Its data service cannot start on an insecure address.'
  }
  return problem === 'slow'
    ? 'The app is taking longer than usual to start. It will continue when ready.'
    : 'The app could not start its data service. Reload the page to try again.'
}
