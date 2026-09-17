/**
 * A loading placeholder. Hidden from assistive technology: loading is announced in words by the caller.
 *
 * The default corner radius applies only when the caller gives none. In Tailwind v4 the utility that comes later in the
 * generated stylesheet wins, whatever the class order, so a default `rounded-md` beside a caller's `rounded-full` could
 * silently win and turn round placeholders square.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  const radius = /(^|\s)rounded(-|\s|$)/.test(className) ? '' : 'rounded-md'
  return <span aria-hidden="true" className={`block animate-pulse bg-skeleton ${radius} ${className}`} />
}
