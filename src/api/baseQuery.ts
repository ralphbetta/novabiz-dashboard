/**
 * The request function every endpoint shares (ADR-0003, ADR-0014).
 *
 *   1. Waits, for a bounded time, until the data service is ready. The app renders at once; requests wait
 *      here rather than the page staying blank (ADR-0005). If the wait runs out, the request is refused
 *      WITHOUT being sent — and a later request can still succeed if the service comes up late.
 *   2. Sends it with a per-attempt timeout.
 *   3. Retries reads — never writes — with full-jitter backoff, within an overall deadline.
 *
 * All timing and the base URL come from the store (ApiExtra), not from the API instance. So there is one
 * API, the one the hooks are bound to, and tests configure it through the store they build.
 */
import { fetchBaseQuery, type BaseQueryFn, type FetchArgs, type FetchBaseQueryError } from '@reduxjs/toolkit/query'
import { REQUEST_NOT_SENT } from '../lib/errors'

export interface HttpConfig {
  /** '' in the browser (same origin). Tests pass an absolute URL, which msw/node needs. */
  baseUrl: string
  /** Per attempt. ADR-0014: 15s. */
  timeoutMs: number
  /**
   * The most a READ may take across all its attempts and backoff before its error is shown. Without it, the
   * worst case is four 15s timeouts plus backoff — over a minute of spinner. Writes have no deadline; they
   * are never retried, so they take one attempt's timeout at most.
   */
  readDeadlineMs: number
  /** Retries after the first attempt, for reads. */
  maxRetries: number
  /** Backoff ceiling doubles from this on each retry: 1s, 2s, 4s… */
  retryBaseDelayMs: number
  retryMaxDelayMs: number
  random: () => number
}

export const DEFAULT_HTTP_CONFIG: HttpConfig = {
  baseUrl: '',
  timeoutMs: 15_000,
  readDeadlineMs: 30_000,
  maxRetries: 3,
  retryBaseDelayMs: 1_000,
  retryMaxDelayMs: 30_000,
  random: Math.random,
}

/** How long a request waits for the data service before it is refused, unsent. */
export const DEFAULT_SERVICE_WAIT_MS = 15_000

/** The store's thunk extra argument, so each store — and each test — has its own. */
export interface ApiExtra {
  /** Resolves when the data service can take requests; rejects if it never will. */
  serviceReady: Promise<void>
  serviceWaitMs: number
  http: HttpConfig
}

/** Per-endpoint options. `maxRetries: 0` lowers a READ's retries; writes are never retried regardless. */
export interface NovabizExtraOptions {
  maxRetries?: number
}

/**
 * Full jitter: a uniformly random delay from 0 up to the capped exponential ceiling. `attempt` is the
 * 1-based number of the attempt that just failed. Without the randomness, every client that lost its
 * connection at the same moment retries in lockstep when it returns.
 */
export function backoffDelayMs(attempt: number, config: Pick<HttpConfig, 'retryBaseDelayMs' | 'retryMaxDelayMs' | 'random'>): number {
  const ceiling = Math.min(config.retryMaxDelayMs, config.retryBaseDelayMs * 2 ** Math.max(0, attempt - 1))
  return Math.floor(config.random() * ceiling)
}

/** Whether a failed attempt may be retried, given how many retries are allowed. Pure. */
export function shouldRetry(error: FetchBaseQueryError, attempt: number, maxRetries: number): boolean {
  if (attempt > maxRetries) return false
  const { status } = error
  if (status === 'FETCH_ERROR' || status === 'TIMEOUT_ERROR') return true
  if (status === 'PARSING_ERROR') return error.originalStatus >= 500 // e.g. a proxy's HTML 502 page
  if (typeof status === 'number') return status >= 500 // a 4xx will be the same 4xx next time
  return false // CUSTOM_ERROR, including a request that was never sent
}

class ServiceWaitTimeout extends Error {}

/** Null once the service is ready; otherwise why this request must not be sent. */
async function waitForService(ready: Promise<void>, waitMs: number): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      ready,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ServiceWaitTimeout()), waitMs) }),
    ])
    return null
  } catch (error) {
    if (error instanceof ServiceWaitTimeout) return 'The data service is still starting'
    return error instanceof Error ? error.message : String(error)
  } finally {
    clearTimeout(timer)
  }
}

const abortableSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
  })

const send = fetchBaseQuery()

export const novabizBaseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError, NovabizExtraOptions> = async (
  args,
  api,
  extraOptions,
) => {
  const { serviceReady, serviceWaitMs, http } = api.extra as ApiExtra

  const notReady = await waitForService(serviceReady, serviceWaitMs)
  if (notReady !== null) {
    // Refused BEFORE fetch is called. This is the only place REQUEST_NOT_SENT may be produced.
    return { error: { status: 'CUSTOM_ERROR', error: REQUEST_NOT_SENT, data: notReady } }
  }

  // Writes are never retried, whatever the endpoint says. The safe behaviour must be the default: a write
  // endpoint added later without `maxRetries: 0` must not be able to send a payment four times.
  // (`extraOptions` is undefined at runtime for endpoints that set none, whatever its type says.)
  const isWrite = api.type === 'mutation'
  const maxRetries = isWrite ? 0 : (extraOptions?.maxRetries ?? http.maxRetries)
  const deadline = isWrite ? Number.POSITIVE_INFINITY : Date.now() + http.readDeadlineMs
  const request: FetchArgs = typeof args === 'string' ? { url: args } : args

  for (let attempt = 1; ; attempt++) {
    const timeout = Math.max(1, Math.min(http.timeoutMs, deadline - Date.now()))
    const result = await send({ ...request, url: `${http.baseUrl}${request.url}`, timeout }, api, {})
    if (!result.error || !shouldRetry(result.error, attempt, maxRetries)) return result

    const delay = backoffDelayMs(attempt, http)
    if (Date.now() + delay >= deadline) return result // no time left for another attempt
    try {
      await abortableSleep(delay, api.signal)
    } catch {
      return result // the request was abandoned, e.g. its component unmounted
    }
  }
}
