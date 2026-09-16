import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { AnnouncerProvider } from '../components/feedback/Announcer'
import { routes } from './routes'

const router = createBrowserRouter(routes)

/** The announcer wraps the router, so its live regions persist across route changes (ADR-0012). */
export default function App() {
  return (
    <AnnouncerProvider>
      <RouterProvider router={router} />
    </AnnouncerProvider>
  )
}
