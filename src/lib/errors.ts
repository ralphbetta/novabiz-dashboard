/**
 * The most important function in the app (ADR-0006): may an optimistic transfer be rolled back?
 *
 * Only when failure is certain. There are exactly two ways to be certain:
 *
 *   1. The server promised it. A response body carrying `error.rejected: true`, which REJECTED_BY_CODE
 *      (src/api/contracts.ts) defines as "no transfer exists under this idempotency key, and none ever will".
 *      Read from the flag, never the status code: a 409 is only possible because a transfer exists, and a
 *      404 from the lookup only means "not yet".
 *   2. The request provably never left the device. REQUEST_NOT_SENT is produced by the base query only
 *      BEFORE it calls fetch — when the data service never became ready. Nothing reached any server, so
 *      nothing can have moved, and reconciling against a service that is not running would be pointless.
 *
 * Everything else — a timeout, a network error, a 5xx, a body that fails the contract, a response we could
 * not parse — means we do not know, and the transfer may have gone through.
 */
import { ApiErrorSchema, type ApiError } from '../api/contracts'

/** The error shape RTK Query's fetchBaseQuery produces, narrowed only as far as this module needs. */
interface HttpErrorLike {
  status: number
  data: unknown
}

function isHttpError(error: unknown): error is HttpErrorLike {
  return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
}

/**
 * The server's contract-valid error body, or null. Null for anything that is not an HTTP error response
 * carrying a body that satisfies ApiErrorSchema — including a body whose `rejected` flag disagrees with its
 * error code, which the schema refuses (see REJECTED_BY_CODE).
 */
export function toApiError(error: unknown): ApiError | null {
  if (!isHttpError(error)) return null
  const parsed = ApiErrorSchema.safeParse(error.data)
  return parsed.success ? parsed.data : null
}

/**
 * The `error` value of a base-query error for a request that was never sent. Only baseQuery.ts produces it,
 * and only before calling fetch. Producing it anywhere a request may have been sent would make
 * isDefiniteFailure lie.
 */
export const REQUEST_NOT_SENT = 'REQUEST_NOT_SENT'

/** True for a request the base query refused to send. See REQUEST_NOT_SENT. */
export function isNotSent(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null &&
    'status' in error && error.status === 'CUSTOM_ERROR' &&
    'error' in error && error.error === REQUEST_NOT_SENT
  )
}

/** True only when rolling back an optimistic transfer is provably safe. See the module comment. */
export function isDefiniteFailure(error: unknown): boolean {
  return toApiError(error)?.error.rejected === true || isNotSent(error)
}
