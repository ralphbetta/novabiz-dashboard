import { describe, it, expect } from 'vitest'
import type { ErrorCode } from '../api/contracts'
import { REQUEST_NOT_SENT, isDefiniteFailure, toApiError } from './errors'

const body = (code: ErrorCode, rejected: boolean) => ({ error: { code, message: 'x', rejected } })

/** The table from ADR-0006, in the shapes RTK Query actually produces. */
const cases: ReadonlyArray<readonly [string, unknown, boolean]> = [
  ['400 VALIDATION_FAILED, rejected', { status: 400, data: body('VALIDATION_FAILED', true) }, true],
  ['422 INSUFFICIENT_FUNDS, rejected', { status: 422, data: body('INSUFFICIENT_FUNDS', true) }, true],
  ['409 IDEMPOTENCY_KEY_REUSED — a transfer exists under the key', { status: 409, data: body('IDEMPOTENCY_KEY_REUSED', false) }, false],
  ['404 NOT_FOUND from the lookup — the POST may still be in flight', { status: 404, data: body('NOT_FOUND', false) }, false],
  ['500 INTERNAL_ERROR', { status: 500, data: body('INTERNAL_ERROR', false) }, false],
  ['a network failure', { status: 'FETCH_ERROR', error: 'TypeError: Failed to fetch' }, false],
  ['a client timeout', { status: 'TIMEOUT_ERROR', error: 'AbortError' }, false],
  ['an unparseable response — the server may have acted', { status: 'PARSING_ERROR', originalStatus: 502, data: '<html>', error: 'SyntaxError' }, false],
  ['a request refused before it was sent — nothing left the device', { status: 'CUSTOM_ERROR', error: REQUEST_NOT_SENT, data: 'x' }, true],
  ['any other custom error — not provably unsent', { status: 'CUSTOM_ERROR', error: 'SOMETHING_ELSE' }, false],
  ['a SerializedError, e.g. a response that failed the contract', { name: 'ZodError', message: 'invalid' }, false],
  ['a 502 from a proxy with a non-contract body', { status: 502, data: { message: 'Bad Gateway' } }, false],
  ['undefined', undefined, false],
  ['null', null, false],
]

describe('isDefiniteFailure — the ADR-0006 table', () => {
  it.each(cases)('%s → %s', (_label, error, expected) => {
    expect(isDefiniteFailure(error)).toBe(expected)
  })
})

describe('isDefiniteFailure trusts the server\'s flag or a provably unsent request, never the status code', () => {
  it('refuses a 422 whose body lies about rejection for its code', () => {
    // INTERNAL_ERROR may never claim rejected: true; the contract schema refuses it, so this is not definite.
    expect(isDefiniteFailure({ status: 422, data: body('INTERNAL_ERROR', true) })).toBe(false)
  })

  it('refuses a 4xx status with no contract body', () => {
    expect(isDefiniteFailure({ status: 422, data: { rejected: true } })).toBe(false)
    expect(isDefiniteFailure({ status: 400, data: 'Bad Request' })).toBe(false)
  })

  it('does not accept rejected: true at the top level instead of inside error', () => {
    expect(isDefiniteFailure({ status: 422, data: { code: 'INSUFFICIENT_FUNDS', message: 'x', rejected: true } })).toBe(false)
  })
})

describe('toApiError', () => {
  it('returns the parsed body for a contract-valid error response', () => {
    expect(toApiError({ status: 422, data: body('INSUFFICIENT_FUNDS', true) })).toEqual(body('INSUFFICIENT_FUNDS', true))
  })

  it('returns null for anything else', () => {
    expect(toApiError({ status: 'TIMEOUT_ERROR', error: 'x' })).toBeNull()
  })
})
