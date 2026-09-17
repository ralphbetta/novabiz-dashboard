import { formatTime } from '../../lib/format'
import { useAppSelector } from '../../store/hooks'
import { selectOnline } from '../../store/connectivitySlice'

/**
 * While offline, how old the figures on screen are: "Offline · as of 14:32" (ADR-0014). Loaded data stays readable
 * offline, so it must say when it was loaded. Renders nothing while online, or when nothing has loaded.
 */
export function OfflineNote({ loadedAt, className = '' }: { loadedAt: number | Date | undefined; className?: string }) {
  const online = useAppSelector(selectOnline)
  if (online || loadedAt === undefined) return null
  return <p className={`text-sm ${className}`}>Offline · as of {formatTime(new Date(loadedAt))}</p>
}
