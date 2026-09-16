import type { ReactNode } from 'react'
import { Icon, type IconName } from '../ui/Icon'

/** Empty and error states. Every screen that fetches has one: no blank areas, no endless spinners. */
export function StateMessage({
  icon,
  title,
  children,
  action,
  tone = 'neutral',
}: {
  icon: IconName
  title: string
  children?: ReactNode
  action?: ReactNode
  tone?: 'neutral' | 'danger'
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span
        className={`grid size-12 place-items-center rounded-full ${tone === 'danger' ? 'bg-danger-subtle text-danger' : 'bg-surface-muted text-fg-muted'}`}
      >
        <Icon name={icon} className="size-6" />
      </span>
      <h3 className="mt-4 text-base font-semibold text-fg">{title}</h3>
      {children ? <p className="mt-1 max-w-sm text-sm text-fg-muted">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}
