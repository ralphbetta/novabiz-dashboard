/**
 * What to tell a merchant when a request fails. Written for the person reading it: say what happened in plain
 * language and what they can do, never an HTTP status or an error name.
 */
import { isNotSent, toApiError } from './errors'

export interface RequestErrorDescription {
  title: string
  detail: string
  /** Whether trying again could help. A malformed request will fail the same way again. */
  canRetry: boolean
}

export function describeRequestError(error: unknown, subject: string): RequestErrorDescription {
  if (isNotSent(error)) {
    return { title: `Couldn't load ${subject}`, detail: 'The app is still starting. Try again in a moment.', canRetry: true }
  }
  const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined
  if (status === 'FETCH_ERROR' || status === 'TIMEOUT_ERROR') {
    return { title: `Couldn't load ${subject}`, detail: 'Check your internet connection, then try again.', canRetry: true }
  }
  const apiError = toApiError(error)
  if (apiError?.error.code === 'VALIDATION_FAILED') {
    return { title: `Couldn't load ${subject}`, detail: 'Those filters could not be applied. Try different ones.', canRetry: false }
  }
  if (typeof status === 'number' && status >= 500) {
    return { title: `Couldn't load ${subject}`, detail: 'Something went wrong on our side. Try again in a moment.', canRetry: true }
  }
  return { title: `Couldn't load ${subject}`, detail: 'Something unexpected happened. Try again in a moment.', canRetry: true }
}
