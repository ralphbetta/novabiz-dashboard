// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest'
import { clearAllListeners } from '@reduxjs/toolkit'
import { act, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { SendMoneyRequestSchema, TransactionSchema } from '../api/contracts'
import { makeStore } from '../store'
import { transferDraft } from '../store/transferDraftSlice'
import { TransactionRow } from '../features/transactions/TransactionRow'
import { OpenTransferNotice } from './OpenTransferNotice'

const KEY = '3f1c9a52-7b3e-4d2a-9c1e-5a6b7c8d9e0f'
const request = SendMoneyRequestSchema.parse({
  recipient: { accountNumber: '0123456789', bankCode: '058', accountName: 'Ngozi Okafor' },
  amountKobo: 500_000,
})
const row = TransactionSchema.parse({
  id: `optimistic-${KEY}`, reference: 'Processing', type: 'debit', status: 'pending', channel: 'transfer', amountKobo: 500_000,
  description: 'Transfer to Ngozi Okafor', counterparty: { name: 'Ngozi Okafor', bankName: 'Guaranty Trust Bank', accountNumberLast4: '6789' },
  createdAt: '2026-09-16T10:30:00.000Z', idempotencyKey: KEY, failureReason: null,
})

const stores: ReturnType<typeof makeStore>[] = []
// The store's transfer tracker starts checking an unknown transfer; stop it when the test ends.
afterEach(() => { for (const store of stores.splice(0)) store.dispatch(clearAllListeners()) })

function renderAt(path: string) {
  // A data service that never becomes ready, so the tracker's checks never leave the test.
  const store = makeStore({ serviceReady: new Promise<void>(() => {}) })
  stores.push(store)
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <OpenTransferNotice />
        <div role="table" aria-label="Transactions"><div role="rowgroup"><TransactionRow transaction={row} rowIndex={1} now={new Date('2026-09-16T11:00:00.000Z')} /></div></div>
      </MemoryRouter>
    </Provider>,
  )
  return store
}

describe('an unconfirmed transfer outside the receipt', () => {
  it('labels its row "Awaiting confirmation", not "Pending", only while its outcome is unknown', () => {
    const store = renderAt('/dashboard')
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0)
    act(() => {
      store.dispatch(transferDraft.attemptStarted({ idempotencyKey: KEY, request }))
      store.dispatch(transferDraft.attemptUnknown({ idempotencyKey: KEY }))
    })
    expect(screen.getAllByText('Awaiting confirmation').length).toBeGreaterThan(0)
    expect(screen.queryByText('Pending')).not.toBeInTheDocument()

    act(() => { store.dispatch(transferDraft.attemptAccepted({ idempotencyKey: KEY, transfer: { reference: 'NVB1', status: 'pending', failureReason: null } })) })
    expect(screen.queryByText('Awaiting confirmation')).not.toBeInTheDocument()
  })

  it('shows a notice on other pages telling the merchant not to send it again', () => {
    const store = renderAt('/dashboard')
    expect(screen.queryByText(/Please don.t send it again/)).not.toBeInTheDocument()
    act(() => {
      store.dispatch(transferDraft.attemptStarted({ idempotencyKey: KEY, request }))
      store.dispatch(transferDraft.attemptUnknown({ idempotencyKey: KEY }))
    })
    expect(screen.getByText('We’re confirming a transfer.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', '/dashboard/send-money')

    act(() => { store.dispatch(transferDraft.attemptNeedsAttention({ idempotencyKey: KEY })) })
    expect(screen.getByText('We still can’t confirm a transfer.')).toBeInTheDocument()
  })

  it('does not show the notice on the Send Money page, which shows the receipt', () => {
    const store = renderAt('/dashboard/send-money')
    act(() => {
      store.dispatch(transferDraft.attemptStarted({ idempotencyKey: KEY, request }))
      store.dispatch(transferDraft.attemptUnknown({ idempotencyKey: KEY }))
    })
    expect(screen.queryByText('We’re confirming a transfer.')).not.toBeInTheDocument()
  })
})
