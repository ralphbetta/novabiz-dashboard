import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react'
import { Icon } from './Icon'

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className' | 'size'> {
  label: string
  /** Help shown under the field, and read with it. */
  hint?: ReactNode
  /** The validation message. Present means invalid. */
  error?: string | undefined
  /** Text or an element shown inside the field, before the input, such as a currency symbol. */
  adornment?: ReactNode
  /** Shown inside the field, after the input, such as a character count. Hidden from screen readers. */
  trailing?: ReactNode
  /** `lg` for the one value a step is about, such as the amount. */
  size?: 'md' | 'lg'
  className?: string
  ref?: Ref<HTMLInputElement>
}

/**
 * A labelled text input (ADR-0009, ADR-0012). The label is a real `<label for>`, never a placeholder standing in for
 * one. The hint and the error are linked with `aria-describedby`, and an error sets `aria-invalid`, so a screen reader
 * reads the problem when focus reaches the field.
 *
 * The border is `border-field`, at least 3:1: an empty input has no text to show it is a field (ADR-0010). The focus
 * outline is drawn around the whole box, adornment included, instead of on the bare input inside it.
 */
export function TextField({ label, hint, error, adornment, trailing, size = 'md', className = '', ref, ...input }: TextFieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined

  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-fg">{label}</label>
      <div
        className={`flex items-center gap-2 rounded-xl border ${size === 'lg' ? 'min-h-18 px-4' : 'min-h-12 px-3'} bg-surface focus-within:border-accent focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-focus ${error ? 'border-danger' : 'border-border-field hover:border-border-strong'}`}
      >
        {adornment ? <span aria-hidden="true" className={size === 'lg' ? 'text-2xl font-semibold text-fg-muted' : 'text-base text-fg-muted'}>{adornment}</span> : null}
        <input
          id={id}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-muted ${size === 'lg' ? 'py-3 text-3xl font-semibold tracking-tight tabular-nums' : 'py-2.5 text-base'}`}
          {...input}
        />
        {trailing ? <span aria-hidden="true" className="shrink-0 text-sm text-fg-muted tabular-nums">{trailing}</span> : null}
      </div>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      {hint ? <p id={hintId} className="mt-1.5 text-sm text-fg-muted">{hint}</p> : null}
    </div>
  )
}

/** A field's validation message. Give it an id and point the field's `aria-describedby` at it. */
export function FieldError({ id, children }: { id: string | undefined; children: ReactNode }) {
  return (
    <p id={id} className="mt-1.5 flex items-start gap-1.5 text-sm text-danger">
      <Icon name="alert" className="mt-0.5 size-4" />
      {children}
    </p>
  )
}
