import { createContext, useContext } from 'react'

export type Politeness = 'polite' | 'assertive'
export type Announce = (message: string, politeness?: Politeness) => void

export const AnnouncerContext = createContext<Announce | null>(null)

/** Announce a message to screen readers through the app's live regions (see Announcer.tsx). */
export function useAnnounce(): Announce {
  const announce = useContext(AnnouncerContext)
  if (!announce) throw new Error('useAnnounce must be used inside AnnouncerProvider')
  return announce
}
