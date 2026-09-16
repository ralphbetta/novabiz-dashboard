import { Outlet, useMatches } from 'react-router'
import { AppShell } from './AppShell'
import { RouteFocus } from './RouteFocus'
import type { RouteHandle } from './routes'

/** The layout every dashboard route renders inside: sidebar, navbar, and the page in <Outlet />. */
export function DashboardLayout() {
  const matches = useMatches()
  const handle = matches.at(-1)?.handle as RouteHandle | undefined
  return (
    <AppShell title={handle?.title ?? 'Dashboard'}>
      <RouteFocus />
      <Outlet />
    </AppShell>
  )
}
