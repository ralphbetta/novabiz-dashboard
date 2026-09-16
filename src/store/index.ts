/**
 * The Redux store (ADR-0003, ADR-0004). One store: RTK Query's cache now, client-only slices later.
 */
import { configureStore } from '@reduxjs/toolkit'
import { DEFAULT_HTTP_CONFIG, DEFAULT_SERVICE_WAIT_MS, type ApiExtra, type HttpConfig } from '../api/baseQuery'
import { novabizApi } from '../api/novabizApi'

export interface StoreOptions {
  /** Resolves when the data service is ready. Defaults to already-ready. */
  serviceReady?: Promise<void>
  /** How long each request waits for it before being refused unsent. */
  serviceWaitMs?: number
  /** Overrides for base URL and timing. Tests use this for fast retries and msw/node's absolute URLs. */
  http?: Partial<HttpConfig>
}

export function makeStore({ serviceReady = Promise.resolve(), serviceWaitMs = DEFAULT_SERVICE_WAIT_MS, http = {} }: StoreOptions = {}) {
  // Mark a rejection as handled. Requests still see it, since each awaits the original promise, but a startup
  // failure before any request is made must not surface as an unhandled rejection.
  serviceReady.catch(() => {})
  const extra: ApiExtra = { serviceReady, serviceWaitMs, http: { ...DEFAULT_HTTP_CONFIG, ...http } }
  return configureStore({
    reducer: { [novabizApi.reducerPath]: novabizApi.reducer },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ thunk: { extraArgument: extra } }).concat(novabizApi.middleware),
  })
}

export type AppStore = ReturnType<typeof makeStore>
export type RootState = ReturnType<AppStore['getState']>
export type AppDispatch = AppStore['dispatch']
