/** A loading placeholder. Hidden from assistive technology: loading is announced in words by the caller. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-md bg-skeleton ${className}`} />
}
