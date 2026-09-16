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
import { TIMEOUT_HOLD_MS, type ChaosController, type ChaosFailure } from './chaos'
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
   * Awaited after a request is parsed and before the db is called. Tests use it to hold a request "in
   * flight" deterministically.
   */
  beforeProcessing?: (request: Request) => Promise<void>
  /** Latency, injected errors and timeouts. Absent means a fast, perfectly reliable server. */
  chaos?: ChaosController
}

const simulatedError = () =>
  errorResponse('INTERNAL_ERROR', 'Simulated server error. Check the transfer status before retrying.')

/** What the db step produced: the response, and the id of the transfer if this request created one. */
interface Processed {
  response: Response
  createdTransferId?: string
}

export function createHandlers(db: MockDb, { beforeProcessing, chaos }: HandlerOptions = {}) {
  /**
   * An injected failure. An error answers 500 at once. A timeout holds `response` for TIMEOUT_HOLD_MS —
   * long after the client has given up — then releases it: see chaos.ts for why it is not held forever.
   */
  async function inject(failure: ChaosFailure, response: Response): Promise<Response> {
    if (failure.kind === 'error') return simulatedError()
    await chaos?.sleep(TIMEOUT_HOLD_MS)
    return response
  }

  /**
   * Every request that passes validation runs through here, in this order. A request that fails
   * validation is answered at once, with no latency or injected failure.
   *   1. hold (test gate) and simulated latency — all awaiting happens BEFORE the db, see db.ts;
   *   2. a failure injected before commit: nothing is written;
   *   3. the db call;
   *   4. a failure injected after commit — only if this request created a transfer. The write stands,
   *      and the client never learns the outcome. A request that wrote nothing (a read, a replay, a db
   *      rejection) is never given an after-commit failure: its real answer, such as a 422 with
   *      `rejected: true`, is returned as-is.
   */
  async function runWithChaos(request: Request, isTransferWrite: boolean, run: () => Processed): Promise<Response> {
    await beforeProcessing?.(request)
    const decision = chaos?.decide(isTransferWrite) ?? { delayMs: 0, failure: null, settlementRoll: 0 }
    if (decision.delayMs > 0 && chaos) await chaos.sleep(decision.delayMs)

    if (decision.failure?.when === 'before-commit') return inject(decision.failure, simulatedError())

    const { response, createdTransferId } = run()
    if (createdTransferId === undefined || !chaos) return response

    // A forced after-commit outcome, if armed, takes precedence over a random one.
    const forced = chaos.onTransferCreated(createdTransferId, decision.settlementRoll)
    const afterCommit = forced ?? (decision.failure?.when === 'after-commit' ? decision.failure : null)
    return afterCommit ? inject(afterCommit, response) : response
  }

  return [
    http.get(`*${API.balance}`, withErrorBoundary(({ request }) =>
      runWithChaos(request, false, () => ({ response: fromResult(db.getBalance()) })),
    )),

    http.get(`*${API.transactions}`, withErrorBoundary(({ request }) => {
      const query = TransactionQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
      if (!query.success) return validationError(query.error, 'Invalid transaction query')
      return runWithChaos(request, false, () => ({ response: fromResult(db.listTransactions(query.data)) }))
    })),

    http.post(`*${API.transfers}`, withErrorBoundary(async ({ request }) => {
      const key = IdempotencyKeySchema.safeParse(request.headers.get(IDEMPOTENCY_HEADER))
      if (!key.success) {
        return errorResponse('VALIDATION_FAILED', `A valid ${IDEMPOTENCY_HEADER} header is required`, {
          [IDEMPOTENCY_HEADER]: 'Must be a UUID',
        })
      }
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return errorResponse('VALIDATION_FAILED', 'Request body must be valid JSON')
      }
      const parsed = SendMoneyRequestSchema.safeParse(body)
      if (!parsed.success) return validationError(parsed.error, 'Invalid transfer')

      return runWithChaos(request, true, () => {
        const result = db.createTransfer(parsed.data, key.data)
        if (!result.ok) return { response: errorResponse(result.code, result.message, result.fieldErrors) }
        const { transfer, replayed } = result.value
        // 202 for both the original and a replay: the same request gets the same status. The header
        // distinguishes them, and the body carries the transfer's current state.
        const response = HttpResponse.json(
          { transfer },
          { status: 202, headers: { [REPLAYED_HEADER]: String(replayed) } },
        )
        return replayed ? { response } : { response, createdTransferId: transfer.id }
      })
    })),

    http.get(`*${API.transfers}`, withErrorBoundary(({ request }) => {
      const key = IdempotencyKeySchema.safeParse(new URL(request.url).searchParams.get('idempotencyKey'))
      if (!key.success) {
        return errorResponse('VALIDATION_FAILED', 'A valid idempotencyKey query parameter is required', {
          idempotencyKey: 'Must be a UUID',
        })
      }
      return runWithChaos(request, false, () => {
        const result = db.findTransferByKey(key.data)
        return {
          response: result.ok
            ? HttpResponse.json({ transfer: result.value })
            : errorResponse(result.code, result.message, result.fieldErrors),
        }
      })
    })),
  ]
}
