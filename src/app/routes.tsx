import { Navigate, type RouteObject } from 'react-router'
import { DashboardLayout } from './DashboardLayout'
import { OverviewPage } from '../pages/OverviewPage'
import { TransactionsPage } from '../pages/TransactionsPage'
import { SendMoneyPage } from '../pages/SendMoneyPage'
import { NotFoundPage } from '../pages/NotFoundPage'

export interface RouteHandle {
  /** Shown in the navbar. */
  title: string
}

export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/dashboard" replace /> },
  {
    path: '/dashboard',
    element: <DashboardLayout />,
    children: [
      { index: true, element: <OverviewPage />, handle: { title: 'Dashboard' } satisfies RouteHandle },
      { path: 'transactions', element: <TransactionsPage />, handle: { title: 'Transactions' } satisfies RouteHandle },
      { path: 'send-money', element: <SendMoneyPage />, handle: { title: 'Send money' } satisfies RouteHandle },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]
