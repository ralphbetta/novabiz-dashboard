import { IconButton } from '../components/ui/Button'
import { Icon } from '../components/ui/Icon'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { preferences, resolveTheme } from '../store/preferencesSlice'

/**
 * Dark mode on or off (ADR-0010). Until the merchant presses it the app follows the phone's setting; pressing it saves
 * their own choice. A toggle rather than a three-way menu, so it fits as one icon in the top bar.
 *
 * `bar` is the top-bar icon. `menu` is a full row for the phone menu: at 360px the top bar has no room for another
 * icon without wrapping the page title, so below 640px the toggle lives in the menu instead.
 */
export function ThemeToggle({ placement = 'bar' }: { placement?: 'bar' | 'menu' }) {
  const dispatch = useAppDispatch()
  const preference = useAppSelector((s) => s.preferences.theme)
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  const dark = resolveTheme(preference, systemDark) === 'dark'
  const toggle = () => dispatch(preferences.themeChosen({ theme: dark ? 'light' : 'dark' }))

  if (placement === 'bar') {
    return (
      <IconButton label="Dark mode" aria-pressed={dark} onClick={toggle}>
        <Icon name={dark ? 'moon' : 'sun'} />
      </IconButton>
    )
  }
  return (
    <button
      type="button"
      aria-pressed={dark}
      onClick={toggle}
      className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-brand-fg-muted transition hover:bg-brand-raised hover:text-brand-fg"
    >
      <Icon name={dark ? 'moon' : 'sun'} className="size-5" />
      Dark mode
      <span aria-hidden="true" className="ml-auto text-xs font-semibold text-brand-fg">{dark ? 'On' : 'Off'}</span>
    </button>
  )
}
