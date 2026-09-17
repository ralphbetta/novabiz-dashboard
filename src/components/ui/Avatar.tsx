const TONES = [
  'surface-brand text-brand-fg',
  'bg-credit-subtle text-credit',
  'bg-pending-subtle text-pending',
  'bg-surface-muted text-accent',
] as const

/** Up to two initials: "Ngozi Okafor" → "NO", "Kano Grains Depot" → "KG". */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => /\p{L}/u.test(word))
  return words.slice(0, 2).map((word) => [...word][0]?.toLocaleUpperCase('en-NG') ?? '').join('') || '?'
}

/**
 * Initials in a circle, for a person or business. Decorative: the name is always shown in text beside it. The colour
 * is picked from the name, so the same payee always looks the same.
 */
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  let hash = 0
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  const sizeClass = size === 'lg' ? 'size-14 text-lg' : size === 'sm' ? 'size-9 text-xs' : 'size-11 text-sm'
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-full font-semibold ${sizeClass} ${TONES[hash % TONES.length]}`}>
      {initials(name)}
    </span>
  )
}
