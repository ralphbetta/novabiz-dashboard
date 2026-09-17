// @vitest-environment jsdom
/**
 * Hostile text from the seed renders as inert, visible text (ADR-0013): through the API boundary, which sanitises it, and
 * into a row, which never interprets it as HTML.
 */
import { describe, it, expect } from 'vitest'
import { render, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { Provider } from 'react-redux'
import { TransactionSchema } from '../../api/contracts'
import { HOSTILE_COUNTERPARTY_NAME, HOSTILE_DESCRIPTIONS } from '../../mocks/seed'
import { makeStore } from '../../store'
import { TransactionRow } from './TransactionRow'

/** Bidi controls, zero-width characters and the byte-order mark, written as escapes (source-hygiene.test.ts). */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/

function renderRow(description: string, counterpartyName = 'Ngozi Okafor') {
  // The same boundary the app uses: every response is parsed, and untrusted text sanitised, by the contract.
  const transaction = TransactionSchema.parse({
    id: 'txn-1', reference: 'NVB20260916000001', type: 'debit', status: 'successful', channel: 'transfer', amountKobo: 500_000,
    description, counterparty: { name: counterpartyName, bankName: 'Guaranty Trust Bank', accountNumberLast4: '6789' },
    createdAt: '2026-09-16T10:30:00.000Z', idempotencyKey: null, failureReason: null,
  })
  const { container } = render(
    <Provider store={makeStore({ serviceReady: new Promise<void>(() => {}) })}>
      <MemoryRouter>
        <div role="table" aria-label="Transactions"><div role="rowgroup">
          <TransactionRow transaction={transaction} rowIndex={1} now={new Date('2026-09-16T11:00:00.000Z')} />
        </div></div>
      </MemoryRouter>
    </Provider>,
  )
  return { row: within(container).getByRole('row'), transaction }
}

describe('hostile text in a transaction row (ADR-0013)', () => {
  it.each(Object.entries(HOSTILE_DESCRIPTIONS))('the %s description renders as inert text', (_key, description) => {
    const { row, transaction } = renderRow(description)
    expect(row.querySelector('script, img, b, iframe')).toBeNull()
    expect(row.textContent ?? '').not.toMatch(INVISIBLE)
    if (transaction.description) expect(row.textContent).toContain(transaction.description)
  })

  it('shows the markup itself, as characters, for the script and image payloads', () => {
    expect(renderRow(HOSTILE_DESCRIPTIONS.scriptTag).row).toHaveTextContent('<script>alert("xss")</script>')
    expect(renderRow(HOSTILE_DESCRIPTIONS.imgOnError).row).toHaveTextContent('<img src=x onerror="alert(1)">')
  })

  it('a counterparty name with HTML renders as text, not bold', () => {
    const { row } = renderRow('Refund', HOSTILE_COUNTERPARTY_NAME)
    expect(row.querySelector('b')).toBeNull()
    expect(row).toHaveTextContent(HOSTILE_COUNTERPARTY_NAME)
  })
})
