import { lazy, Suspense, useRef, type ReactNode } from 'react'
import { Icon } from '../components/ui/Icon'
import { IconButton } from '../components/ui/Button'
import { MERCHANT } from './merchant'
import { NavList } from './navigation'
import { OpenTransferNotice } from './OpenTransferNotice'
import { ThemeToggle } from './ThemeToggle'
import { ConnectionBanner } from '../features/connection/ConnectionBanner'
import { useMockControls } from '../features/mockControls/mockControlsContext'

/**
 * The Mock API panel is loaded only once the mock has started, so neither it nor the mock code it uses is in the main
 * bundle — and a build without the mock never downloads it (ADR-0005).
 */
const MockApiControls = lazy(() => import('../features/mockControls/MockApiControls').then((module) => ({ default: module.MockApiControls })))

function MockApiSlot() {
  const controls = useMockControls()
  if (!controls) return null
  return (
    <Suspense fallback={null}>
      <MockApiControls />
    </Suspense>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span aria-hidden="true" className="grid size-9 place-items-center rounded-xl bg-brand-fg text-sm font-bold text-brand">
        N
      </span>
      <span className="leading-tight">
        <span className="block text-base font-semibold tracking-tight text-brand-fg">NovaBiz</span>
        <span className="block text-xs text-brand-fg-muted">by NovaPay</span>
      </span>
    </div>
  )
}

function MerchantCard() {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-brand-raised p-3">
      <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-fg text-sm font-semibold text-brand">
        {MERCHANT.initials}
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-semibold text-brand-fg">{MERCHANT.name}</span>
        <span className="block text-xs text-brand-fg-muted">
          <span className="sr-only">Account ending </span>
          <span aria-hidden="true">Account ••</span>
          {MERCHANT.accountLast4}
        </span>
      </span>
    </div>
  )
}

function SidebarContent({ onNavigate, onClose }: { onNavigate?: () => void; onClose?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-8 p-4">
      <div className="flex items-center justify-between gap-2 px-2 pt-2">
        <Brand />
        {onClose ? (
          <IconButton label="Close menu" variant="ghost-on-brand" onClick={onClose} className="-mr-2">
            <Icon name="x" />
          </IconButton>
        ) : null}
      </div>
      <nav aria-label="Main" className="flex-1">
        <NavList {...(onNavigate ? { onNavigate } : {})} />
      </nav>
      {/* The phone menu only, below 640px: there the top bar has no room for the toggle. */}
      {onClose ? <div className="sm:hidden"><ThemeToggle placement="menu" /></div> : null}
      <MerchantCard />
    </div>
  )
}

/**
 * The dashboard frame (ADR-0010): a persistent sidebar from 1024px, and below that a navbar whose menu button
 * opens the same navigation as a drawer. Rendered once by DashboardLayout; pages swap inside it.
 *
 * The drawer is a native <dialog> opened with showModal(): the browser supplies the focus trap, Escape to close,
 * an inert background and focus returned to the menu button — with no dialog library to download.
 */
export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const drawer = useRef<HTMLDialogElement>(null)
  const openDrawer = () => {
    const dialog = drawer.current
    if (!dialog) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  }
  const closeDrawer = () => drawer.current?.close()

  return (
    <div className="min-h-dvh bg-canvas">
      <a
        href="#main"
        className="sr-only z-50 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-fg focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 surface-brand lg:block">
        <SidebarContent />
      </aside>

      <dialog
        ref={drawer}
        aria-label="Main menu"
        onClick={(e) => { if (e.target === e.currentTarget) closeDrawer() }}
        className="m-0 h-dvh max-h-none w-72 max-w-[85vw] surface-brand p-0 backdrop:bg-fg/50 lg:hidden"
      >
        {/* The close button lives in the brand row. An earlier layout pulled the content up over a separate close
            row with a negative margin, and its transparent box covered most of the button, so taps missed it. */}
        <SidebarContent onNavigate={closeDrawer} onClose={closeDrawer} />
      </dialog>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-border bg-surface">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <IconButton label="Open menu" onClick={openDrawer} className="-ml-2 lg:hidden">
              <Icon name="menu" />
            </IconButton>
            <p className="text-base font-semibold text-fg">{title}</p>
            <div className="ml-auto flex items-center gap-4">
              <MockApiSlot />
              <div className="hidden sm:block"><ThemeToggle /></div>
              <span className="hidden h-6 w-px bg-border md:block" aria-hidden="true" />
              <div className="flex items-center gap-3">
                <span className="hidden text-right leading-tight sm:block">
                  <span className="block text-sm font-semibold text-fg">{MERCHANT.name}</span>
                  <span className="block text-xs text-fg-muted">Merchant</span>
                </span>
                <span aria-hidden="true" className="grid size-9 place-items-center rounded-full surface-brand text-xs font-semibold text-brand-fg">
                  {MERCHANT.initials}
                </span>
              </div>
            </div>
          </div>
          {/* In the sticky header, so it stays in view on every page while the connection is gone. */}
          <ConnectionBanner />
        </header>

        <main id="main" tabIndex={-1} className="mx-auto max-w-[96rem] px-4 pt-6 pb-16 focus:outline-none sm:px-6 lg:px-8">
          <OpenTransferNotice />
          {children}
        </main>
      </div>
    </div>
  )
}
