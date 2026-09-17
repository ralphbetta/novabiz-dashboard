import { Navigate, type RouteObject } from 'react-router'
import { DashboardLayout } from './DashboardLayout'
import { NotFoundPage } from '../pages/NotFoundPage'
import { PageLoading } from './PageLoading'

export interface RouteHandle {
  /** Shown in the navbar. */
  title: string
}

/**
 * Each page's code loads when it is first opened, not with the app (ADR-0015). A router `lazy` route, not React.lazy:
 * the router finishes loading the page before it changes the location, so the new page's heading is already there
 * when RouteFocus moves focus to it, and no page flashes a spinner on navigation.
 */
export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/dashboard" replace /> },
  {
    path: '/dashboard',
    element: <DashboardLayout />,
    HydrateFallback: PageLoading,
    children: [
      {
        index: true,
        handle: { title: 'Dashboard' } satisfies RouteHandle,
        lazy: async () => ({ Component: (await import('../pages/OverviewPage')).OverviewPage }),
      },
      {
        path: 'transactions',
        handle: { title: 'Transactions' } satisfies RouteHandle,
        lazy: async () => ({ Component: (await import('../pages/TransactionsPage')).TransactionsPage }),
      },
      {
        path: 'send-money',
        handle: { title: 'Send money' } satisfies RouteHandle,
        lazy: async () => ({ Component: (await import('../pages/SendMoneyPage')).SendMoneyPage }),
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]
