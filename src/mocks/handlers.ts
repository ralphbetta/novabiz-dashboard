/**
 * The mock API's HTTP layer (ADR-0005): request parsing, status codes, headers. All business rules
 * live in db.ts. Every request is validated against the shared contract at runtime. Responses are
 * validated against it in tests (handlers.test.ts), not at runtime.
 *
 * Paths start with `*` so they match on any origin — the page's own in the browser, and an absolute
 * test URL under msw/node.
 */
import { http, HttpResponse, type HttpResponseResolver, type JsonBodyType } from 'msw'
import type { z } from 'zod'
import {
  API,
  IDEMPOTENCY_HEADER,
  IdempotencyKeySchema,
  REJECTED_BY_CODE,
  SendMoneyRequestSchema,
  TransactionQuerySchema,
  type ApiErrorWire,
  type ErrorCode,
} from '../api/contracts'
import type { MockDb, Result } from './db'

/** Set on every transfer response: whether this request replayed an earlier one with the same key. */
export const REPLAYED_HEADER = 'Idempotent-Replayed'

export const STATUS_BY_CODE = {
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  IDEMPOTENCY_KEY_REUSED: 409,
  INSUFFICIENT_FUNDS: 422,
  INTERNAL_ERROR: 500,
} as const satisfies Record<ErrorCode, number>

/**
 * The only way a handler builds an error. `rejected` comes from the contract's table, never from the
 * call site, so no handler can send an INTERNAL_ERROR that tells the client nothing was written.
 */
function errorResponse(code: ErrorCode, message: string, fieldErrors?: Record<string, string>) {
  const body: ApiErrorWire = {
    error: { code, message, rejected: REJECTED_BY_CODE[code], ...(fieldErrors ? { fieldErrors } : {}) },
  }
  return HttpResponse.json(body, { status: STATUS_BY_CODE[code] })
}

function validationError(error: z.ZodError, message = 'The request is invalid') {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_'
    fieldErrors[path] ??= issue.message
  }
  return errorResponse('VALIDATION_FAILED', message, fieldErrors)
}

function fromResult<T extends JsonBodyType>(result: Result<T>, status = 200) {
  return result.ok
    ? HttpResponse.json(result.value, { status })
    : errorResponse(result.code, result.message, result.fieldErrors)
}

/**
 * Any unexpected exception becomes a contract-valid INTERNAL_ERROR with `rejected: false`.
 *
 * Without this, MSW answers a thrown error with its own generic 500, whose body is not an ApiError.
 * The client would then classify a response it cannot parse. And `rejected: false` is the only safe
 * claim here: a crash part-way through a transfer may have written something, so the client must
 * reconcile rather than roll back (ADR-0006).
 */
function withErrorBoundary(resolver: HttpResponseResolver): HttpResponseResolver {
  return async (info) => {
    try {
      return await resolver(info)
    } catch (error) {
      console.error('[mock api] unhandled error', error)
      return errorResponse('INTERNAL_ERROR', 'Something went wrong on our side. Check the transfer status before retrying.')
    }
  }
}

export interface HandlerOptions {
  /**
   * Awaited after a request is parsed and before the db is called. Part 3's simulated latency plugs in
   * here, which keeps any await out of the db's check-then-write. Tests use it to hold a request "in
   * flight" deterministically.
   */
  beforeProcessing?: (request: Request) => Promise<void>
}

export function createHandlers(db: MockDb, { beforeProcessing }: HandlerOptions = {}) {
  return [
    http.get(`*${API.balance}`, withErrorBoundary(async ({ request }) => {
      await beforeProcessing?.(request)
      return fromResult(db.getBalance())
    })),

    http.get(`*${API.transactions}`, withErrorBoundary(async ({ request }) => {
      const query = TransactionQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
      if (!query.success) return validationError(query.error, 'Invalid transaction query')
      await beforeProcessing?.(request)
      return fromResult(db.listTransactions(query.data))
    })),

    http.post(`*${API.transfers}`, withErrorBoundary(async ({ request }) => {
      const key = IdempotencyKeySchema.safeParse(request.headers.get(IDEMPOTENCY_HEADER))
      if (!key.success) {
        return errorResponse('VALIDATION_FAILED', `A valid ${IDEMPOTENCY_HEADER} header is required`, {
          [IDEMPOTENCY_HEADER]: 'Must be a UUID',
        })
      }

      // Everything that awaits happens here, before the db is touched. See the note in db.ts.
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return errorResponse('VALIDATION_FAILED', 'Request body must be valid JSON')
      }
      const parsed = SendMoneyRequestSchema.safeParse(body)
      if (!parsed.success) return validationError(parsed.error, 'Invalid transfer')
      await beforeProcessing?.(request)

      const result = db.createTransfer(parsed.data, key.data)
      if (!result.ok) return errorResponse(result.code, result.message, result.fieldErrors)
      // 202 for both the original and a replay: the same request gets the same status. The header
      // distinguishes them, and the body carries the transfer's current state.
      return HttpResponse.json(
        { transfer: result.value.transfer },
        { status: 202, headers: { [REPLAYED_HEADER]: String(result.value.replayed) } },
      )
    })),

    http.get(`*${API.transfers}`, withErrorBoundary(async ({ request }) => {
      const key = IdempotencyKeySchema.safeParse(new URL(request.url).searchParams.get('idempotencyKey'))
      if (!key.success) {
        return errorResponse('VALIDATION_FAILED', 'A valid idempotencyKey query parameter is required', {
          idempotencyKey: 'Must be a UUID',
        })
      }
      await beforeProcessing?.(request)
      const result = db.findTransferByKey(key.data)
      return result.ok
        ? HttpResponse.json({ transfer: result.value })
        : errorResponse(result.code, result.message, result.fieldErrors)
    })),
  ]
}
