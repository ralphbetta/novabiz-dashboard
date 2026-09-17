import { useEffect, useState, type ReactNode } from 'react'
import { MockControlsContext, type MockControls } from './mockControlsContext'

/**
 * Makes the Mock API's controls available once the mock has started. The app renders before that (main.tsx), so the
 * controls arrive as a promise; until it resolves, and in a build without the mock, there are none and no panel shows.
 */
export function MockControlsProvider({ controls, children }: { controls: Promise<MockControls | null> | MockControls | null; children: ReactNode }) {
  const [resolved, setResolved] = useState<MockControls | null>(null)

  useEffect(() => {
    if (!(controls instanceof Promise)) return
    let current = true
    controls.then((next) => { if (current) setResolved(next) }, () => { if (current) setResolved(null) })
    return () => { current = false }
  }, [controls])

  const value = controls instanceof Promise ? resolved : controls
  return <MockControlsContext.Provider value={value}>{children}</MockControlsContext.Provider>
}
