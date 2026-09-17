import type { FieldErrors } from 'react-hook-form'

/** What a screen reader hears when Continue finds problems. Focus also moves to the first invalid field. */
export function problemMessage(errors: FieldErrors): string {
  const messages = Object.values(errors).flatMap((error) => (error?.message ? [String(error.message)] : []))
  if (messages.length === 0) return 'Check the details and try again'
  return messages.length === 1
    ? `There is a problem: ${messages[0]}`
    : `There are ${messages.length} problems. First: ${messages[0]}`
}
