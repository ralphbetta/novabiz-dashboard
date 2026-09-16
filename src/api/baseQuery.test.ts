import { describe, it, expect } from 'vitest'
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query'
import { backoffDelayMs, shouldRetry } from './baseQuery'
import { REQUEST_NOT_SENT } from '../lib/errors'

const err = (status: FetchBaseQueryError['status'], extra: object = {}) => ({ status, ...extra }) as FetchBaseQueryError

describe('shouldRetry', () => {
  it.each([
    ['a network error', err('FETCH_ERROR', { error: 'x' }), true],
    ['a timeout', err('TIMEOUT_ERROR', { error: 'x' }), true],
    ['a 500', err(500, { data: null }), true],
    ['a 503', err(503, { data: null }), true],
    ['a proxy 502 with an unparseable body', err('PARSING_ERROR', { originalStatus: 502, data: '', error: 'x' }), true],
    ['an unparseable 200', err('PARSING_ERROR', { originalStatus: 200, data: '', error: 'x' }), false],
    ['a 400', err(400, { data: null }), false],
    ['a 404', err(404, { data: null }), false],
    ['a 409', err(409, { data: null }), false],
    ['a 422', err(422, { data: null }), false],
    ['a request refused unsent while the data service was not ready', err('CUSTOM_ERROR', { error: REQUEST_NOT_SENT }), false],
  ])('%s → %s (within the retry limit)', (_label, error, expected) => {
    expect(shouldRetry(error, 1, 3)).toBe(expected)
  })

  it('enforces the retry limit itself, since RTK does not once retryCondition is used', () => {
    const timeout = err('TIMEOUT_ERROR', { error: 'x' })
    expect([1, 2, 3, 4].map((attempt) => shouldRetry(timeout, attempt, 3))).toEqual([true, true, true, false])
  })

  it('maxRetries 0 never retries anything — the rule that stops a payment being sent twice', () => {
    for (const error of [err('TIMEOUT_ERROR', { error: 'x' }), err('FETCH_ERROR', { error: 'x' }), err(500, { data: null })]) {
      expect(shouldRetry(error, 1, 0)).toBe(false)
    }
  })
})

describe('backoffDelayMs — exponential backoff with full jitter', () => {
  const config = { retryBaseDelayMs: 1_000, retryMaxDelayMs: 30_000 }

  it('doubles the ceiling each retry: 1s, 2s, 4s, 8s', () => {
    const atCeiling = (attempt: number) => backoffDelayMs(attempt, { ...config, random: () => 0.999_999 })
    expect([1, 2, 3, 4].map(atCeiling)).toEqual([999, 1_999, 3_999, 7_999])
  })

  it('caps the ceiling at the maximum', () => {
    expect(backoffDelayMs(20, { ...config, random: () => 0.999_999 })).toBe(29_999)
  })

  it('can be anywhere from 0 up to the ceiling — full jitter, not a fixed schedule', () => {
    expect(backoffDelayMs(3, { ...config, random: () => 0 })).toBe(0)
    expect(backoffDelayMs(3, { ...config, random: () => 0.5 })).toBe(2_000)
  })
})
