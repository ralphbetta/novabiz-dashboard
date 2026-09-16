import { Link } from 'react-router'
import { usePageTitle } from '../app/pageTitle'
import { Icon } from '../components/ui/Icon'

export function NotFoundPage() {
  usePageTitle('Page not found')
  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-canvas px-4">
      <div className="text-center">
        <p className="text-sm font-semibold text-accent">404</p>
        <h1 tabIndex={-1} className="mt-2 text-2xl font-semibold text-fg focus:outline-none">We couldn&rsquo;t find that page</h1>
        <p className="mt-2 text-sm text-fg-muted">The link may be old, or the address mistyped.</p>
        <Link to="/dashboard" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg">
          <Icon name="dashboard" className="size-4" />
          Go to your dashboard
        </Link>
      </div>
    </main>
  )
}
