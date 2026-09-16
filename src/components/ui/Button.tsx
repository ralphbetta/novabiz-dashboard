import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'on-brand' | 'ghost-on-brand'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:opacity-90',
  secondary: 'border border-border-control bg-surface text-fg hover:border-border-strong hover:bg-surface-muted',
  ghost: 'text-fg hover:bg-surface-muted',
  'on-brand': 'bg-brand-raised text-brand-fg hover:opacity-90',
  'ghost-on-brand': 'text-brand-fg hover:bg-brand-raised',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

/**
 * At least 44×44px at every width (ADR-0010). Defaults to type="button" so it never submits a form by accident.
 *
 * Colours come only from the variant. Do not override text or background colour through `className`: in Tailwind
 * v4 the utility that appears later in the generated stylesheet wins, regardless of class order, so an override can
 * silently lose. Add a variant instead.
 */
export function Button({ variant = 'secondary', className = '', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
}

/** An icon-only button. The label is required, because the icon carries no text of its own. */
export function IconButton({ label, variant = 'ghost', className = '', ...props }: ButtonProps & { label: string }) {
  return <Button variant={variant} aria-label={label} title={label} className={`px-0 ${className}`} {...props} />
}
