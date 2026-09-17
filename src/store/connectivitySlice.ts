/**
 * Whether the browser reports a connection (ADR-0014).
 *
 * Kept apart from RTK Query's own online flag on purpose: the reconnect guard holds RTK's `onOnline` back while a
 * transfer's outcome is open (ADR-0006), so RTK's flag can say "offline" for a while after the connection is back. The
 * banner and the Send button must follow the connection itself.
 *
 * `navigator.onLine` false is reliable: there is no network. True only means a network exists, not that the server is
 * reachable, so "online" never promises a request will work; failures are still handled where they happen.
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export interface ConnectivityState {
  online: boolean
}

const initialState: ConnectivityState = { online: true }

export const connectivitySlice = createSlice({
  name: 'connectivity',
  initialState,
  reducers: {
    connectionChanged(state, action: PayloadAction<{ online: boolean }>) {
      state.online = action.payload.online
    },
  },
})

export const connectivity = connectivitySlice.actions

/** True unless the browser reports no connection. A store without this slice counts as online. */
export const selectOnline = (state: { connectivity?: ConnectivityState }): boolean => state.connectivity?.online !== false

/** Records the browser's connection now and whenever it changes. Returns a function that stops watching. */
export function watchConnection(
  dispatch: (action: ReturnType<typeof connectivity.connectionChanged>) => unknown,
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> & { navigator: Pick<Navigator, 'onLine'> } = window,
): () => void {
  const update = () => dispatch(connectivity.connectionChanged({ online: target.navigator.onLine !== false }))
  update()
  target.addEventListener('online', update)
  target.addEventListener('offline', update)
  return () => {
    target.removeEventListener('online', update)
    target.removeEventListener('offline', update)
  }
}
