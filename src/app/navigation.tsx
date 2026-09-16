import { NavLink } from 'react-router'
import { Icon, type IconName } from '../components/ui/Icon'

const NAV_ITEMS: { label: string; icon: IconName; to: string; end?: boolean }[] = [
  { label: 'Dashboard', icon: 'dashboard', to: '/dashboard', end: true },
  { label: 'Transactions', icon: 'list', to: '/dashboard/transactions' },
  { label: 'Send money', icon: 'send', to: '/dashboard/send-money' },
]

/** The main navigation, shared by the desktop sidebar and the mobile drawer. NavLink sets aria-current="page". */
export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            {...(item.end ? { end: true } : {})}
            onClick={onNavigate}
            className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-brand-fg-muted transition hover:bg-brand-raised hover:text-brand-fg aria-[current=page]:bg-brand-raised aria-[current=page]:text-brand-fg"
          >
            <Icon name={item.icon} className="size-5" />
            {item.label}
          </NavLink>
        </li>
      ))}
    </ul>
  )
}
