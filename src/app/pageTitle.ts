import { useEffect } from 'react'

/** Sets the document title for a page. Focus on navigation is RouteFocus's job, in the layout. */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · NovaBiz`
  }, [title])
}
