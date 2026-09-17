/**
 * The Redux store (ADR-0003, ADR-0004). One store: RTK Query's cache and the client-only Send Money draft.
 */
import { configureStore } from '@reduxjs/toolkit'
import { DEFAULT_HTTP_CONFIG, DEFAULT_SERVICE_WAIT_MS, type ApiExtra, type HttpConfig } from '../api/baseQuery'
import { novabizApi } from '../api/novabizApi'
import { transferDraftSlice } from './transferDraftSlice'
import { DEFAULT_TRACKING_CONFIG, createTransferTracker, type TrackingConfig } from './transferTracker'
import { reconnectGuard } from './reconnectGuard'

export interface StoreOptions {
  /** Resolves when the data service is ready. Defaults to already-ready. */
  serviceReady?: Promise<void>
  /** How long each request waits for it before being refused unsent. */
  serviceWaitMs?: number
  /** Overrides for base URL and timing. Tests use this for fast retries and msw/node's absolute URLs. */
  http?: Partial<HttpConfig>
  /** How often and for how long accepted transfers are checked until they settle. Tests shorten it. */
  tracking?: Partial<TrackingConfig>
}

export function makeStore({ serviceReady = Promise.resolve(), serviceWaitMs = DEFAULT_SERVICE_WAIT_MS, http = {}, tracking = {} }: StoreOptions = {}) {
  // Mark a rejection as handled. Requests still see it, since each awaits the original promise, but a startup
  // failure before any request is made must not surface as an unhandled rejection.
  serviceReady.catch(() => {})
  const extra: ApiExtra = { serviceReady, serviceWaitMs, http: { ...DEFAULT_HTTP_CONFIG, ...http } }
  return configureStore({
    reducer: {
      [novabizApi.reducerPath]: novabizApi.reducer,
      [transferDraftSlice.reducerPath]: transferDraftSlice.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ thunk: { extraArgument: extra } })
        // The tracker must come before the guard: it has to see a reconnect the guard holds back, and reconcile first.
        .prepend(createTransferTracker({ ...DEFAULT_TRACKING_CONFIG, ...tracking }).middleware, reconnectGuard)
        .concat(novabizApi.middleware),
  })
}

export type AppStore = ReturnType<typeof makeStore>
export type RootState = ReturnType<AppStore['getState']>
export type AppDispatch = AppStore['dispatch']
