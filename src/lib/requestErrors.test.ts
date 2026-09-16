import { describe, it, expect } from 'vitest'
import { REQUEST_NOT_SENT } from './errors'
import { describeRequestError } from './requestErrors'

describe('describeRequestError', () => {
  it.each([
    ['a request refused while the app starts', { status: 'CUSTOM_ERROR', error: REQUEST_NOT_SENT }, /still starting/, true],
    ['a network failure', { status: 'FETCH_ERROR', error: 'x' }, /internet connection/, true],
    ['a timeout', { status: 'TIMEOUT_ERROR', error: 'x' }, /internet connection/, true],
    ['a server error', { status: 500, data: { error: { code: 'INTERNAL_ERROR', message: 'x', rejected: false } } }, /on our side/, true],
    ['invalid filters', { status: 400, data: { error: { code: 'VALIDATION_FAILED', message: 'x', rejected: true } } }, /filters/, false],
    ['a response the app could not read', { name: 'ZodError', message: 'x' }, /unexpected/, true],
  ])('%s', (_label, error, detail, canRetry) => {
    const described = describeRequestError(error, 'transactions')
    expect(described.title).toBe("Couldn't load transactions")
    expect(described.detail).toMatch(detail)
    expect(described.canRetry).toBe(canRetry)
  })

  it('never shows a status code or error name to the merchant', () => {
    const { title, detail } = describeRequestError({ status: 503, data: null }, 'your balance')
    expect(`${title} ${detail}`).not.toMatch(/\d{3}|error|Error/)
  })
})
