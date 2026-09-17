import { createContext, useContext, useSyncExternalStore } from 'react'
import type { MockControls } from '../../mocks/browser'

export type { MockControls }

/** The Mock API's controls once the mock has started, or null — before it starts, or in a build without the mock. */
export const MockControlsContext = createContext<MockControls | null>(null)

export function useMockControls(): MockControls | null {
  return useContext(MockControlsContext)
}

/** The chaos settings and armed outcomes, kept current as they change — including when a request uses one up. */
export function useChaosState(controls: MockControls) {
  return useSyncExternalStore(controls.chaos.subscribe, controls.chaos.getSnapshot)
}
