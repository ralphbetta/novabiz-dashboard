/**
 * Name enquiry and beneficiaries in the mock server (ADR-0018).
 */
import { afterAll, afterEach, beforeAll, describe, it, expect } from 'vitest'
import { setupServer } from 'msw/node'
import {
  API,
  AccountLookupSchema,
  ApiErrorSchema,
  BeneficiariesSchema,
  SendMoneyRequestSchema,
} from '../api/contracts'
import { KNOWN_ACCOUNTS, UNKNOWN_ACCOUNT_PREFIX, accountHolder } from './directory'
import { createMockDb } from './db'
import { createHandlers } from './handlers'

const NOW = new Date('2026-09-16T10:30:00.000Z')
const KEY = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const transfer = (accountNumber: string, bankCode: string, accountName: string) =>
  SendMoneyRequestSchema.parse({ recipient: { accountNumber, bankCode, accountName }, amountKobo: 50_000 })

describe('accountHolder', () => {
  it('gives the same name for the same account every time, and different names across accounts', () => {
    const names = ['1234567890', '1234567891', '5550001112', '8081234567'].map((n) => accountHolder('057', n))
    expect(names).toEqual(['1234567890', '1234567891', '5550001112', '8081234567'].map((n) => accountHolder('057', n)))
    expect(names.every((name) => typeof name === 'string' && name.length > 0)).toBe(true)
    expect(new Set(names).size).toBeGreaterThan(1)
  })

  it('depends on the bank as well as the number', () => {
    const across = ['011', '044', '057', '058', '070'].map((bank) => accountHolder(bank, '4455667788'))
    expect(new Set(across).size).toBeGreaterThan(1)
  })

  it(`finds no account for numbers starting ${UNKNOWN_ACCOUNT_PREFIX}`, () => {
    expect(accountHolder('058', `${UNKNOWN_ACCOUNT_PREFIX}1234567`)).toBeNull()
  })

  it('returns the fixed holders for known accounts', () => {
    for (const [key, name] of Object.entries(KNOWN_ACCOUNTS)) {
      const [bank = '', number = ''] = key.split(':')
      expect(accountHolder(bank, number)).toBe(name)
    }
  })
})

describe('mock db — transfers check the account holder', () => {
  it('refuses a transfer whose name does not match the account, and binds the refusal to the key', () => {
    const db = createMockDb({ now: () => NOW })
    const wrong = db.createTransfer(transfer('0123456789', '058', 'Someone Else'), KEY(1))
    expect(wrong).toMatchObject({ ok: false, code: 'VALIDATION_FAILED', fieldErrors: { 'recipient.accountName': 'Does not match the account holder' } })
    // The same key with the same payload gets the same refusal.
    expect(db.createTransfer(transfer('0123456789', '058', 'Someone Else'), KEY(1))).toEqual(wrong)
  })

  it('accepts the holder name regardless of case and spacing', () => {
    const db = createMockDb({ now: () => NOW })
    expect(db.createTransfer(transfer('0123456789', '058', '  ngozi   OKAFOR '), KEY(2)).ok).toBe(true)
  })

  it('refuses a transfer to an account that does not exist', () => {
    const db = createMockDb({ now: () => NOW })
    expect(db.createTransfer(transfer(`${UNKNOWN_ACCOUNT_PREFIX}1234567`, '058', 'Ngozi Okafor'), KEY(3)))
      .toMatchObject({ ok: false, code: 'VALIDATION_FAILED', fieldErrors: { 'recipient.accountNumber': 'No account found' } })
  })

  it('moves a paid recipient to the front of the beneficiaries, with the holder name, without duplicates', () => {
    const db = createMockDb({ now: () => NOW })
    const before = db.listBeneficiaries()
    if (!before.ok) throw new Error('unreachable')
    expect(before.value.items.map((b) => b.lastPaidAt)).toEqual([...before.value.items.map((b) => b.lastPaidAt)].sort().reverse())

    expect(db.createTransfer(transfer('1122334455', '057', 'emeka nwosu'), KEY(4)).ok).toBe(true)
    const after = db.listBeneficiaries()
    if (!after.ok) throw new Error('unreachable')
    expect(after.value.items[0]).toEqual({ accountNumber: '1122334455', bankCode: '057', accountName: 'Emeka Nwosu', lastPaidAt: NOW.toISOString() })
    expect(after.value.items.filter((b) => b.accountNumber === '1122334455')).toHaveLength(1)
    expect(after.value.items).toHaveLength(before.value.items.length)
  })

  it('does not remember a recipient whose transfer was refused', () => {
    const db = createMockDb({ now: () => NOW })
    db.createTransfer(SendMoneyRequestSchema.parse({ recipient: { accountNumber: '4455667788', bankCode: '070', accountName: accountHolder('070', '4455667788') }, amountKobo: 10_000_000_000 }), KEY(5))
    const list = db.listBeneficiaries()
    expect(list.ok && list.value.items.some((b) => b.accountNumber === '4455667788')).toBe(false)
  })
})

describe('handlers — account lookup and beneficiaries', () => {
  const BASE = 'http://novabiz.test'
  const server = setupServer()
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterEach(() => server.resetHandlers())
  afterAll(() => server.close())
  const lookup = (accountNumber: string, bankCode: string) =>
    fetch(`${BASE}${API.accountLookup}?${new URLSearchParams({ accountNumber, bankCode })}`)

  it('returns a contract-valid holder for an account', async () => {
    server.use(...createHandlers(createMockDb({ now: () => NOW })))
    const response = await lookup('0123456789', '058')
    expect(response.status).toBe(200)
    expect(AccountLookupSchema.parse(await response.json())).toEqual({ accountNumber: '0123456789', bankCode: '058', accountName: 'Ngozi Okafor' })
  })

  it('answers 404 NOT_FOUND, not rejected, for an account that does not exist', async () => {
    server.use(...createHandlers(createMockDb({ now: () => NOW })))
    const response = await lookup(`${UNKNOWN_ACCOUNT_PREFIX}1234567`, '058')
    expect(response.status).toBe(404)
    expect(ApiErrorSchema.parse(await response.json()).error).toMatchObject({ code: 'NOT_FOUND', rejected: false })
  })

  it('refuses a malformed account number or an unknown bank', async () => {
    server.use(...createHandlers(createMockDb({ now: () => NOW })))
    expect((await lookup('12345', '058')).status).toBe(400)
    const unknownBank = await lookup('0123456789', '999')
    expect(unknownBank.status).toBe(400)
    expect(ApiErrorSchema.parse(await unknownBank.json()).error.fieldErrors).toEqual({ bankCode: 'Select a bank' })
  })

  it('lists contract-valid beneficiaries', async () => {
    server.use(...createHandlers(createMockDb({ now: () => NOW })))
    const response = await fetch(`${BASE}${API.beneficiaries}`)
    expect(response.status).toBe(200)
    expect(BeneficiariesSchema.parse(await response.json()).items.length).toBe(Object.keys(KNOWN_ACCOUNTS).length)
  })
})
