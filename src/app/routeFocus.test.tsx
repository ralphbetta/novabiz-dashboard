// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { StrictMode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, Outlet, RouterProvider, createMemoryRouter } from 'react-router'
import { usePageTitle } from './pageTitle'
import { RouteFocus } from './RouteFocus'

function Page({ title, to }: { title: string; to: string }) {
  usePageTitle(title)
  return (
    <>
      <h1 tabIndex={-1}>{title}</h1>
      <Link to={to}>Go</Link>
    </>
  )
}

/** A minimal app: the same layout mechanics as DashboardLayout, in StrictMode as main.tsx renders it. */
function renderApp() {
  const router = createMemoryRouter(
    [{
      path: '/',
      element: <main><RouteFocus /><Outlet /></main>,
      children: [
        { path: 'a', element: <Page title="Page A" to="/b" /> },
        { path: 'b', element: <Page title="Page B" to="/a" /> },
      ],
    }],
    { initialEntries: ['/a'] },
  )
  render(<StrictMode><RouterProvider router={router} /></StrictMode>)
}

describe('route-change focus', () => {
  // Run twice, in both orders relative to the navigation test: a module-level flag made results order-dependent.
  it.each([1, 2])('review finding: does NOT move focus to the heading on first load, even in StrictMode (run %i)', async () => {
    renderApp()
    await screen.findByRole('heading', { name: 'Page A' })
    expect(screen.getByRole('heading', { name: 'Page A' })).not.toHaveFocus()
  })

  it('moves focus to the new page\'s heading after navigating, and sets the document title', async () => {
    renderApp()
    await userEvent.setup().click(await screen.findByRole('link', { name: 'Go' }))
    const heading = await screen.findByRole('heading', { name: 'Page B' })
    expect(heading).toHaveFocus()
    expect(document.title).toBe('Page B · NovaBiz')
  })

  it.each([1, 2])('still does not focus on first load after a navigation test has run (run %i)', async () => {
    renderApp()
    await screen.findByRole('heading', { name: 'Page A' })
    expect(screen.getByRole('heading', { name: 'Page A' })).not.toHaveFocus()
  })
})
