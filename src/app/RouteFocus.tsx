import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'

/**
 * Route-change focus (ADR-0012): after navigating, move focus to the new page's <h1> inside <main>, so a screen
 * reader announces the page instead of staying silent on the link that was activated. Not on first load.
 *
 * "First load" is decided by comparing against the previous pathname held in this component's own ref. An earlier
 * module-level flag broke in two ways: React StrictMode runs effects twice on mount, so the second run saw the flag
 * already set and focused the heading on first load; and the flag survived between tests in the same file.
 */
export function RouteFocus() {
  const { pathname } = useLocation()
  const previous = useRef<string | null>(null)
  useEffect(() => {
    if (previous.current !== null && previous.current !== pathname) {
      document.querySelector<HTMLElement>('main h1')?.focus()
    }
    previous.current = pathname
  }, [pathname])
  return null
}
