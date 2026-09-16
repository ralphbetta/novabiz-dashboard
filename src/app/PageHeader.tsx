import type { ReactNode } from 'react'

/** A page's heading. Focusable by script only, so route changes can move focus to it (see RouteFocus). */
export function PageHeader({ title, children, actions }: { title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 tabIndex={-1} className="text-2xl font-semibold tracking-tight text-fg focus:outline-none">
          {title}
        </h1>
        {children ? <p className="mt-1 text-sm text-fg-muted">{children}</p> : null}
      </div>
      {actions}
    </div>
  )
}
