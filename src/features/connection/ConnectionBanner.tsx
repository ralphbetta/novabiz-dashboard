import { useEffect, useState } from 'react'
import { Icon } from '../../components/ui/Icon'
import { useAppSelector } from '../../store/hooks'
import { selectOnline } from '../../store/connectivitySlice'

/** How long "Back online" stays up before the strip closes. */
export const BACK_ONLINE_MS = 4_000

/**
 * A strip under the top bar while the browser reports no connection (ADR-0014), and briefly once it is back.
 *
 * It stays for as long as the connection is gone, rather than a toast that fades while the merchant is still offline.
 * The live region is mounted from the first render and only its content changes, so both messages are announced
 * (ADR-0012).
 */
export function ConnectionBanner() {
  const online = useAppSelector(selectOnline)
  const [lastOnline, setLastOnline] = useState(online)
  const [backOnline, setBackOnline] = useState(false)
  // Adjusting state during render when the connection changes, not in an effect: no frame shows the old message.
  if (online !== lastOnline) {
    setLastOnline(online)
    setBackOnline(online)
  }
  useEffect(() => {
    if (!backOnline) return
    const timer = setTimeout(() => setBackOnline(false), BACK_ONLINE_MS)
    return () => clearTimeout(timer)
  }, [backOnline])

  return (
    <div role="status">
      {!online ? (
        <p className="flex items-start gap-2 border-t border-border bg-pending-subtle px-4 py-2.5 text-sm text-pending sm:items-center sm:px-6 lg:px-8">
          <Icon name="wifi-off" className="mt-px size-4 sm:mt-0" />
          <span>
            <span className="font-semibold">You’re offline.</span> You can still see what was already loaded. Sending money
            is paused until you’re back online.
          </span>
        </p>
      ) : backOnline ? (
        <p className="flex items-center gap-2 border-t border-border bg-credit-subtle px-4 py-2.5 text-sm font-semibold text-credit sm:px-6 lg:px-8">
          <Icon name="wifi" className="size-4" />
          You’re back online.
        </p>
      ) : null}
    </div>
  )
}
