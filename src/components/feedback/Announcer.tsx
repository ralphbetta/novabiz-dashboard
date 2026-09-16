/**
 * Screen-reader announcements (ADR-0012).
 *
 * Both live regions are mounted once, empty, when the app first renders, and have their text swapped in. A live
 * region inserted at the same moment as its content is often not announced at all. The text is cleared first so
 * that announcing the same message twice is still heard.
 */
import { useCallback, useRef, useState, type ReactNode } from 'react'
import { AnnouncerContext, type Announce, type Politeness } from './announcerContext'

export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState('')
  const [assertive, setAssertive] = useState('')
  // One timer per region. A shared timer let an assertive message cancel a polite one sent moments earlier, so
  // the polite message was never spoken. A newer message in the same region still replaces the older one.
  const timers = useRef<Record<Politeness, ReturnType<typeof setTimeout> | undefined>>({ polite: undefined, assertive: undefined })

  const announce = useCallback<Announce>((message, politeness = 'polite') => {
    const set = politeness === 'assertive' ? setAssertive : setPolite
    set('')
    clearTimeout(timers.current[politeness])
    timers.current[politeness] = setTimeout(() => set(message), 50)
  }, [])

  return (
    <AnnouncerContext.Provider value={announce}>
      {children}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="announcer-polite">
        {polite}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only" data-testid="announcer-assertive">
        {assertive}
      </div>
    </AnnouncerContext.Provider>
  )
}

