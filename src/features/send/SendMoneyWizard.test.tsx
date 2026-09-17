// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, it, expect } from 'vitest'
import { clearAllListeners } from '@reduxjs/toolkit'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { IDEMPOTENCY_HEADER, SendMoneyRequestSchema } from '../../api/contracts'
import { novabizApi } from '../../api/novabizApi'
import { makeStore, type AppStore } from '../../store'
import { transferDraft } from '../../store/transferDraftSlice'
import { connectivity } from '../../store/connectivitySlice'
import { TIMEOUT_HOLD_MS, createChaosController } from '../../mocks/chaos'
import { DEFAULT_SETTLEMENT_DELAY_MS, createMockDb } from '../../mocks/db'
import { createHandlers } from '../../mocks/handlers'
import { formatAmount, formatNaira, toKobo } from '../../lib/money'
import { AnnouncerProvider } from '../../components/feedback/Announcer'
import { axeViolations } from '../../test/axe'
import { SendMoneyWizard } from './SendMoneyWizard'

const BASE = 'http://novabiz.test'
const server = setupServer()
const postKeys: (string | null)[] = []
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  server.events.on('request:start', ({ request }) => { if (request.method === 'POST') postKeys.push(request.headers.get(IDEMPOTENCY_HEADER)) })
})
/** Stores made by a test: their transfer trackers outlive the test unless stopped. */
const stores: AppStore[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.dispatch(clearAllListeners())
  server.resetHandlers()
  postKeys.length = 0
})
afterAll(() => server.close())

const FIRST_PAGE = { filters: {}, limit: 25, cursor: null }
const KEY = '3f1c9a52-7b3e-4d2a-9c1e-5a6b7c8d9e0f'

function renderWizard({ tracking = {} }: { tracking?: { giveUpAfterMs?: number } } = {}) {
  let current = new Date('2026-09-16T10:30:00.000Z').getTime()
  const chaos = createChaosController({
    settings: { latencyMs: 0, jitterMs: 0 },
    random: () => 0.99,
    sleep: (ms) => (ms === TIMEOUT_HOLD_MS ? new Promise<never>(() => {}) : Promise.resolve()),
  })
  const db = createMockDb({ now: () => new Date(current), settlementOutcome: chaos.settlementOutcome })
  const gates = { post: Promise.resolve(), lookup: Promise.resolve() }
  server.use(...createHandlers(db, {
    chaos,
    beforeProcessing: async (request) => {
      if (request.method === 'POST') await gates.post
      if (new URL(request.url).pathname === '/api/accounts/lookup') await gates.lookup
    },
  }))
  const store = makeStore({ http: { baseUrl: BASE, timeoutMs: 300, retryBaseDelayMs: 1, retryMaxDelayMs: 2 }, tracking: { initialIntervalMs: 5, maxIntervalMs: 5, ...tracking } })
  stores.push(store)
  // The transactions table has been opened, so its first page is cached and the optimistic row can be seen in it.
  void store.dispatch(novabizApi.endpoints.getTransactionsPage.initiate(FIRST_PAGE))

  const tree = (show: boolean) => (
    <Provider store={store}>
      <MemoryRouter>
        <AnnouncerProvider>
          <main>{show ? <SendMoneyWizard /> : <p>Another page</p>}</main>
        </AnnouncerProvider>
      </MemoryRouter>
    </Provider>
  )
  const { container, rerender } = render(tree(true))
  const hold = (gate: 'post' | 'lookup') => {
    let release = () => {}
    gates[gate] = new Promise<void>((resolve) => { release = resolve })
    return release
  }
  const holdPosts = () => hold('post')
  const holdLookups = () => hold('lookup')
  return {
    user: userEvent.setup(), store, db, chaos, container, holdPosts, holdLookups,
    advance: (ms: number) => { current += ms },
    leave: () => rerender(tree(false)),
    come_back: () => rerender(tree(true)),
  }
}

const assertive = () => screen.getByTestId('announcer-assertive')
const polite = () => screen.getByTestId('announcer-polite')
/** The current step's heading. Side panels have their own h2s, so find it by its marker. */
const stepHeading = () => {
  const heading = document.querySelector<HTMLElement>('[data-step-heading]')
  if (!heading) throw new Error('no step heading')
  return heading
}
const available = (store: AppStore) => novabizApi.endpoints.getBalance.select()(store.getState()).data?.availableBalanceKobo
/** The account lookup's live region (the announcer's own regions sit outside the form). */
const lookupStatus = () => {
  const region = document.querySelector<HTMLElement>('form [role="status"]')
  if (!region) throw new Error('no lookup status region')
  return region
}
/** Resolves once the lookup has verified the account; the region reads "Account verified: <name>". */
const verified = async (name: string) => {
  await waitFor(() => expect(lookupStatus()).toHaveTextContent(`Account verified: ${name}`), { timeout: 5000 })
  return lookupStatus()
}

async function enterAccount(user: UserEvent, accountNumber = '0123456789', bankName = 'Guaranty Trust Bank') {
  await user.type(screen.getByLabelText('Account number'), accountNumber)
  await user.click(screen.getByRole('combobox', { name: 'Bank' }))
  await user.click(screen.getByRole('option', { name: bankName }))
}

async function fillRecipient(user: UserEvent) {
  await enterAccount(user)
  await verified('Ngozi Okafor')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByRole('heading', { name: 'How much are you sending?' })
}

async function fillAmount(user: UserEvent, amount: string) {
  // Wait for the balance, so the amount step's balance rule is in force.
  await screen.findByText(/^Available balance:/, {}, { timeout: 5000 })
  if (amount) await user.type(screen.getByLabelText('Amount in naira'), amount)
  await user.click(screen.getByRole('button', { name: 'Continue' }))
}

describe('Send Money — recipient step', () => {
  it('rejects an empty form: marks each field, moves focus to the first, and announces the problems', async () => {
    const { user } = renderWizard()
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    const accountNumber = await screen.findByLabelText('Account number')
    await waitFor(() => expect(accountNumber).toHaveFocus())
    expect(accountNumber).toHaveAttribute('aria-invalid', 'true')
    expect(accountNumber).toHaveAccessibleDescription(/Account number must be 10 digits/)
    expect(screen.getByRole('combobox', { name: 'Bank' })).toHaveAccessibleDescription('Select a bank')
    // The announcer sets its text a moment after clearing it, so a repeated message is read again.
    await waitFor(() => expect(assertive()).toHaveTextContent('There are 2 problems. First: Account number must be 10 digits'))
    expect(stepHeading()).toHaveTextContent('Who are you paying?')
  })

  it('never asks for a name: it looks the account up and shows the holder, announced politely', async () => {
    const { user } = renderWizard()
    expect(screen.queryByLabelText(/account name/i)).not.toBeInTheDocument()
    await enterAccount(user)
    expect(await verified('Ngozi Okafor')).toBeInTheDocument()
  })

  it('says when no account exists, and will not continue', async () => {
    const { user } = renderWizard()
    await enterAccount(user, '9990001112')
    expect(await screen.findByText('No account found with this number at this bank.', {}, { timeout: 5000 })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(assertive()).toHaveTextContent('There is a problem: No account was found with this number at this bank'))
    expect(screen.getByLabelText('Account number')).toHaveFocus()
    expect(stepHeading()).toHaveTextContent('Who are you paying?')
  })

  it('offers a retry when the lookup fails, and verifies on retry', async () => {
    const { user, chaos } = renderWizard()
    await screen.findAllByRole('button', { name: /Ngozi Okafor/ }, { timeout: 5000 })
    chaos.update({ errorRate: 1 })
    await enterAccount(user)
    expect(await screen.findByText(/couldn.t verify this account/, {}, { timeout: 5000 })).toBeInTheDocument()
    chaos.update({ errorRate: 0 })
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await verified('Ngozi Okafor')).toBeInTheDocument()
  })

  it('fills in and verifies a recent recipient with one tap', async () => {
    const { user } = renderWizard()
    const panel = await screen.findByRole('region', { name: 'Recent recipients' }, { timeout: 5000 })
    const emeka = await within(panel).findByRole('button', { name: /Emeka Nwosu/ })
    expect(emeka).toHaveAttribute('aria-pressed', 'false')
    await user.click(emeka)

    expect(screen.getByLabelText('Account number')).toHaveValue('1122334455')
    expect(within(screen.getByRole('combobox', { name: 'Bank' })).getByText('Zenith Bank')).toBeInTheDocument()
    expect(await verified('Emeka Nwosu')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /Emeka Nwosu/ })).toHaveAttribute('aria-pressed', 'true')
    // Recent recipients are listed without their full account number (ADR-0015).
    expect(within(panel).queryByText('1122334455')).not.toBeInTheDocument()
  })

  it('moves focus to the next step heading and marks the current step', async () => {
    const { user } = renderWizard()
    const steps = () => screen.getByRole('list', { name: 'Transfer steps' })
    expect(within(steps()).getByText('Recipient').closest('li')).toHaveAttribute('aria-current', 'step')
    await fillRecipient(user)
    expect(stepHeading()).toHaveFocus()
    expect(within(steps()).getByText('Amount').closest('li')).toHaveAttribute('aria-current', 'step')
  })

  it('has no axe violations, with and without errors, and once verified', async () => {
    const { user, container } = renderWizard()
    await screen.findAllByRole('button', { name: /Ngozi Okafor/ }, { timeout: 5000 })
    expect(await axeViolations(container)).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Select a bank', { selector: 'p' })
    expect(await axeViolations(container)).toEqual([])
    await enterAccount(user)
    await verified('Ngozi Okafor')
    expect(await axeViolations(container)).toEqual([])
  })
})

describe('Send Money — amount step', () => {
  // Required by the plan (Phase 5): parseNairaInput accepts all four by design, so the form must refuse them.
  it.each(['0', '0.00', '-5', '-₦1,000.00'])('rejects %s with an announced error and stays on the step', async (amount) => {
    const { user } = renderWizard()
    await fillRecipient(user)
    await fillAmount(user, amount)

    const field = screen.getByLabelText('Amount in naira')
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'))
    expect(field).toHaveAccessibleDescription(/Enter an amount greater than zero/)
    await waitFor(() => expect(assertive()).toHaveTextContent('There is a problem: Enter an amount greater than zero'))
    expect(stepHeading()).toHaveTextContent('How much are you sending?')
  })

  it.each([
    ['', 'Enter an amount'],
    // Letters never reach the field (they are dropped while typing), so it is left empty.
    ['abc', 'Enter an amount'],
    ['5.', 'Enter an amount in naira, like 5,000 or 5,000.50'],
    ['-', 'Enter an amount in naira, like 5,000 or 5,000.50'],
    ['99.99', 'The minimum transfer is ₦100.00'],
  ])('rejects %j: %s', async (amount, message) => {
    const { user } = renderWizard()
    await fillRecipient(user)
    await fillAmount(user, amount)
    await waitFor(() => expect(assertive()).toHaveTextContent(`There is a problem: ${message}`))
  })

  it('rejects more than the available balance, naming the balance', async () => {
    const { user, store } = renderWizard()
    await fillRecipient(user)
    await screen.findByText(/^Available balance:/, {}, { timeout: 5000 })
    const balance = available(store)
    if (balance === undefined) throw new Error('balance not loaded')
    await fillAmount(user, formatAmount(toKobo(balance + 100)))
    await waitFor(() => expect(assertive()).toHaveTextContent(`There is a problem: This is more than your available balance of ${formatNaira(balance)}`))
  })

  it('tidies a valid amount when leaving the field', async () => {
    const { user } = renderWizard()
    await fillRecipient(user)
    await user.type(screen.getByLabelText('Amount in naira'), '5000.5')
    await user.tab()
    expect(screen.getByLabelText('Amount in naira')).toHaveValue('5,000.50')
  })

  it('keeps what was typed when going back and forward (tidied on leaving the field)', async () => {
    const { user } = renderWizard()
    await fillRecipient(user)
    await user.type(screen.getByLabelText('Amount in naira'), '2,500')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByLabelText('Account number')).toHaveValue('0123456789')
    await verified('Ngozi Okafor')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByLabelText('Amount in naira')).toHaveValue('2,500.00')
  })
})

describe('Send Money — review and send', () => {
  it('shows the verified name, the full account number, the bank and the exact amount', async () => {
    const { user, container } = renderWizard()
    await fillRecipient(user)
    await fillAmount(user, '5000.5')
    await screen.findByRole('heading', { name: 'Review and send' })

    expect(screen.getByText('Ngozi Okafor', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('0123456789')).toBeInTheDocument()
    expect(screen.getByText(/Guaranty Trust Bank/)).toBeInTheDocument()
    expect(screen.getByText('₦5,000.50', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send ₦5,000.50' })).toBeInTheDocument()
    expect(await axeViolations(container)).toEqual([])
  })

  it('checks every rule again at review: a balance that dropped since step 2 blocks sending', async () => {
    const { user, store, db } = renderWizard()
    await fillRecipient(user)
    await fillAmount(user, '5,000')
    await screen.findByRole('heading', { name: 'Review and send' })

    // Another transfer lands elsewhere and leaves less than ₦5,000 available.
    const balance = available(store) ?? 0
    const spent = db.createTransfer(
      SendMoneyRequestSchema.parse({ recipient: { accountNumber: '0987654321', bankCode: '044', accountName: 'Oyingbo Foodstuff Traders' }, amountKobo: balance - 100_000 }),
      '00000000-0000-4000-8000-000000000009',
    )
    expect(spent.ok).toBe(true)
    await store.dispatch(novabizApi.endpoints.getBalance.initiate(undefined, { forceRefetch: true }))

    expect(await screen.findByText(`This is more than your available balance of ${formatNaira(toKobo(100_000))}`, { selector: 'p' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send money' }))
    await waitFor(() => expect(assertive()).toHaveTextContent('There is a problem: This is more than your available balance'))
    expect(postKeys).toEqual([])
  })

  it('updates the balance and the table at once, then shows the transfer settle', async () => {
    const { user, store, holdPosts, advance } = renderWizard()
    await fillRecipient(user)
    await fillAmount(user, '5,000')
    await screen.findByRole('heading', { name: 'Review and send' })
    const before = available(store) ?? NaN

    const release = holdPosts()
    await user.click(screen.getByRole('button', { name: 'Send ₦5,000.00' }))

    expect(await screen.findByRole('heading', { name: 'Sending your transfer…' })).toHaveFocus()
    expect(available(store)).toBe(before - 500_000)
    const firstRow = novabizApi.endpoints.getTransactionsPage.select(FIRST_PAGE)(store.getState()).data?.items[0]
    expect(firstRow).toMatchObject({ status: 'pending', amountKobo: 500_000, idempotencyKey: postKeys[0] })

    release()
    expect(await screen.findByRole('heading', { name: 'Transfer on its way' }, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText('Reference')).toBeInTheDocument()
    await waitFor(() => expect(polite()).toHaveTextContent('Transfer of ₦5,000.00 received by the bank and on its way'))

    advance(DEFAULT_SETTLEMENT_DELAY_MS)
    expect(await screen.findByRole('heading', { name: 'Transfer successful' }, { timeout: 5000 })).toBeInTheDocument()
    await waitFor(() => expect(polite()).toHaveTextContent('Transfer successful. ₦5,000.00 sent to Ngozi Okafor'))
    expect(postKeys).toHaveLength(1)
  })

  it('sends once when Send is pressed twice', async () => {
    const { user, holdPosts } = renderWizard()
    await fillRecipient(user)
    await fillAmount(user, '5,000')
    const release = holdPosts()
    const send = await screen.findByRole('button', { name: 'Send ₦5,000.00' })
    // Two clicks before React re-renders. user.dblClick lets the first click's render remove the button in between.
    fireEvent.click(send)
    fireEvent.click(send)
    release()
    await screen.findByRole('heading', { name: 'Transfer on its way' }, { timeout: 5000 })
    expect(postKeys).toHaveLength(1)
  })

  it('says "not sent" only for a definite rejection, undoes the balance, and a corrected retry uses a new key', async () => {
    const { user, store, db } = renderWizard()
    await fillRecipient(user)
    await fillAmount(user, '5,000')
    await screen.findByRole('heading', { name: 'Review and send' })
    const before = available(store) ?? NaN

    // The server's balance drops without the app knowing, so its own check passes and the server refuses.
    const spent = db.createTransfer(
      SendMoneyRequestSchema.parse({ recipient: { accountNumber: '0987654321', bankCode: '044', accountName: 'Oyingbo Foodstuff Traders' }, amountKobo: before - 100_000 }),
      '00000000-0000-4000-8000-000000000008',
    )
    expect(spent.ok).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Send ₦5,000.00' }))

    expect(await screen.findByRole('heading', { name: 'Transfer not sent' }, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText('Insufficient funds for this transfer. Nothing was sent.')).toBeInTheDocument()
    await waitFor(() => expect(assertive()).toHaveTextContent('Transfer not sent. Insufficient funds for this transfer. Nothing was sent.'))
    expect(available(store)).toBe(before)

    await user.click(screen.getByRole('button', { name: 'Edit transfer' }))
    expect(await screen.findByRole('heading', { name: 'Review and send' })).toHaveFocus()
    expect(screen.getByText('0123456789')).toBeInTheDocument()

    // A smaller amount is a different intent, so it is a new attempt with a new key (ADR-0007).
    await user.click(screen.getByRole('button', { name: 'Change amount or description' }))
    const amount = await screen.findByLabelText('Amount in naira')
    await user.clear(amount)
    await user.type(amount, '500')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Send ₦500.00' }))
    expect(await screen.findByRole('heading', { name: 'Transfer on its way' }, { timeout: 5000 })).toBeInTheDocument()
    expect(postKeys).toHaveLength(2)
    expect(postKeys[1]).not.toBe(postKeys[0])
  })

  it('never says "not sent" when the outcome is unknown, and keeps the balance reduced', async () => {
    const { user, store, chaos } = renderWizard()
    await fillRecipient(user)
    await fillAmount(user, '5,000')
    await screen.findByRole('heading', { name: 'Review and send' })
    const before = available(store) ?? NaN

    chaos.forceNextTransfer('timeout-before-commit') // nothing is written, so reconciliation keeps checking
    await user.click(screen.getByRole('button', { name: 'Send ₦5,000.00' }))

    expect(await screen.findByRole('heading', { name: 'We’re confirming this transfer' }, { timeout: 5000 })).toBeInTheDocument()
    await waitFor(() => expect(assertive()).toHaveTextContent("We couldn't confirm this transfer yet. We're checking with the bank. The money may already have been sent. Please don't send it again."))
    expect(screen.queryByText(/not sent/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit transfer' })).not.toBeInTheDocument()
    expect(available(store)).toBe(before - 500_000)
    expect(postKeys).toHaveLength(1)
  })

  it('keeps the draft and a transfer in flight when the merchant leaves the page and comes back', async () => {
    const { user, holdPosts, leave, come_back } = renderWizard()
    await fillRecipient(user)
    leave()
    come_back()
    expect(screen.getByRole('heading', { name: 'How much are you sending?' })).toBeInTheDocument()
    expect(screen.getAllByText(/Ngozi Okafor/).length).toBeGreaterThan(0)

    await fillAmount(user, '5,000')
    const release = holdPosts()
    await user.click(await screen.findByRole('button', { name: 'Send ₦5,000.00' }))
    leave()
    release()
    await waitFor(() => expect(postKeys).toHaveLength(1))
    come_back()
    expect(await screen.findByRole('heading', { name: 'Transfer on its way' }, { timeout: 5000 })).toBeInTheDocument()
  })
})

describe('Send Money — review findings', () => {
  const accountNumberField = () => screen.getByLabelText('Account number')

  it('clears the "could not be verified" error once Retry verifies the account', async () => {
    const { user, chaos } = renderWizard()
    await screen.findAllByRole('button', { name: /Ngozi Okafor/ }, { timeout: 5000 })
    chaos.update({ errorRate: 1 })
    await enterAccount(user)
    await screen.findByText(/couldn.t verify this account/, {}, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(accountNumberField()).toHaveAccessibleDescription(/The account could not be verified/))

    chaos.update({ errorRate: 0 })
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await verified('Ngozi Okafor')
    expect(accountNumberField()).not.toHaveAttribute('aria-invalid')
    // Within the form: the announcer's live region still holds the message spoken earlier, which is correct.
    expect(within(accountNumberField().closest('form') as HTMLElement).queryByText(/The account could not be verified/)).not.toBeInTheDocument()
  })

  it('clears the "wait for verification" error once the lookup finishes', async () => {
    const { user, holdLookups } = renderWizard()
    const release = holdLookups()
    await enterAccount(user)
    await screen.findByText('Verifying account…')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(accountNumberField()).toHaveAccessibleDescription(/Wait for the account name to be verified/))

    release()
    await verified('Ngozi Okafor')
    expect(accountNumberField()).not.toHaveAttribute('aria-invalid')
    expect(within(accountNumberField().closest('form') as HTMLElement).queryByText(/Wait for the account name to be verified/)).not.toBeInTheDocument()
  })

  it('shows the description on review exactly as it will be sent: sanitised, with no direction overrides', async () => {
    const { user } = renderWizard()
    await fillRecipient(user)
    await screen.findByText(/^Available balance:/, {}, { timeout: 5000 })
    await user.type(screen.getByLabelText('Amount in naira'), '5,000')
    const override = String.fromCharCode(0x202e)
    const zeroWidth = String.fromCharCode(0x200b)
    await user.type(screen.getByLabelText('Description (optional)'), `Rice${zeroWidth} ${override}deppots`)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Review and send' })

    const description = screen.getByText('Description').nextElementSibling
    expect(description?.textContent).toBe('Rice deppots')
  })

  it('says a failed settlement in one clean sentence, and that the money came back', async () => {
    const { user, chaos, advance } = renderWizard()
    await fillRecipient(user)
    await fillAmount(user, '5,000')
    chaos.forceNextSettlement('failed')
    await user.click(await screen.findByRole('button', { name: 'Send ₦5,000.00' }))
    await screen.findByRole('heading', { name: 'Transfer on its way' }, { timeout: 5000 })
    advance(DEFAULT_SETTLEMENT_DELAY_MS)
    await screen.findByRole('heading', { name: 'Transfer failed' }, { timeout: 5000 })
    expect(screen.getByText(/Beneficiary bank unavailable \(simulated\)\. The money has been returned to your balance\./)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\.\./)
  })

  it('does not claim the money is in the recipient\'s account, only that the bank confirmed it', async () => {
    const { user, advance } = renderWizard()
    await fillRecipient(user)
    await fillAmount(user, '5,000')
    await user.click(await screen.findByRole('button', { name: 'Send ₦5,000.00' }))
    await screen.findByRole('heading', { name: 'Transfer on its way' }, { timeout: 5000 })
    advance(DEFAULT_SETTLEMENT_DELAY_MS)
    await screen.findByRole('heading', { name: 'Transfer successful' }, { timeout: 5000 })
    expect(screen.queryByText(/is now in/)).not.toBeInTheDocument()
    expect(screen.getByText('The bank has confirmed this transfer to Ngozi Okafor.')).toBeInTheDocument()
  })

  it('writes one clean sentence even when a failed settlement carries no reason', async () => {
    const { store } = renderWizard()
    const request = SendMoneyRequestSchema.parse({ recipient: { accountNumber: '0123456789', bankCode: '058', accountName: 'Ngozi Okafor' }, amountKobo: 500_000 })
    act(() => {
      store.dispatch(transferDraft.attemptStarted({ idempotencyKey: KEY, request }))
      store.dispatch(transferDraft.attemptSettled({ idempotencyKey: KEY, transfer: { reference: 'NVB1', status: 'failed', failureReason: null } }))
    })
    expect(await screen.findByRole('heading', { name: 'Transfer failed' })).toBeInTheDocument()
    expect(screen.getByText(/The bank could not complete this transfer\. The money has been returned to your balance\./)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\.\./)
  })

  it('stops promising "a few seconds" once tracking gives up on a still-pending transfer', async () => {
    const { store } = renderWizard()
    const request = SendMoneyRequestSchema.parse({ recipient: { accountNumber: '0123456789', bankCode: '058', accountName: 'Ngozi Okafor' }, amountKobo: 500_000 })
    act(() => {
      store.dispatch(transferDraft.attemptStarted({ idempotencyKey: KEY, request }))
      store.dispatch(transferDraft.attemptAccepted({ idempotencyKey: KEY, transfer: { reference: 'NVB1', status: 'pending', failureReason: null } }))
    })
    expect(await screen.findByText(/usually takes a few seconds/)).toBeInTheDocument()
    act(() => { store.dispatch(transferDraft.trackingStopped({ idempotencyKey: KEY })) })
    expect(await screen.findByRole('heading', { name: 'This is taking longer than usual' })).toBeInTheDocument()
    expect(screen.queryByText(/usually takes a few seconds/)).not.toBeInTheDocument()
    await waitFor(() => expect(polite()).toHaveTextContent('The transfer is taking longer than usual. Please don’t send it again.'))
  })

  it('writes one clean sentence when a failure reason already ends with a full stop', async () => {
    const { store } = renderWizard()
    const request = SendMoneyRequestSchema.parse({ recipient: { accountNumber: '0123456789', bankCode: '058', accountName: 'Ngozi Okafor' }, amountKobo: 500_000 })
    act(() => {
      store.dispatch(transferDraft.attemptStarted({ idempotencyKey: KEY, request }))
      store.dispatch(transferDraft.attemptSettled({ idempotencyKey: KEY, transfer: { reference: 'NVB1', status: 'failed', failureReason: 'Declined by the beneficiary bank.' } }))
    })
    expect(await screen.findByText(/Declined by the beneficiary bank\. The money has been returned to your balance\./)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\.\./)
  })

  it('still shows the typed description when review is blocked', async () => {
    const { user, store, db } = renderWizard()
    await fillRecipient(user)
    await screen.findByText(/^Available balance:/, {}, { timeout: 5000 })
    await user.type(screen.getByLabelText('Amount in naira'), '5,000')
    await user.type(screen.getByLabelText('Description (optional)'), 'Rice supply')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Review and send' })

    const balance = available(store) ?? 0
    const spent = db.createTransfer(
      SendMoneyRequestSchema.parse({ recipient: { accountNumber: '0987654321', bankCode: '044', accountName: 'Oyingbo Foodstuff Traders' }, amountKobo: balance - 100_000 }),
      '00000000-0000-4000-8000-000000000010',
    )
    expect(spent.ok).toBe(true)
    await store.dispatch(novabizApi.endpoints.getBalance.initiate(undefined, { forceRefetch: true }))
    await screen.findByText(/This is more than your available balance/, { selector: 'p' })

    expect(screen.getByText('Description').nextElementSibling?.textContent).toBe('Rice supply')
  })
})

describe('Send Money — reconciliation on the receipt', () => {
  async function sendUnconfirmed(options: Parameters<typeof renderWizard>[0]) {
    const harness = renderWizard(options)
    await fillRecipient(harness.user)
    await fillAmount(harness.user, '5,000')
    await screen.findByRole('heading', { name: 'Review and send' })
    harness.chaos.forceNextTransfer('timeout-before-commit') // nothing is written; every check misses
    await harness.user.click(screen.getByRole('button', { name: 'Send ₦5,000.00' }))
    await screen.findByRole('heading', { name: 'We’re confirming this transfer' }, { timeout: 5000 })
    return harness
  }

  it('after checking without an answer, says so and offers Check status and Try again', async () => {
    await sendUnconfirmed({ tracking: { giveUpAfterMs: 150 } })
    expect(await screen.findByRole('heading', { name: 'We still can’t confirm this transfer' }, { timeout: 5000 })).toBeInTheDocument()
    await waitFor(() => expect(assertive()).toHaveTextContent('We still can’t confirm this transfer. The money may already have been sent. Check its status before sending again.'))
    expect(screen.getByRole('button', { name: 'Check status' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByText(/uses the same reference, so it cannot pay twice/)).toBeInTheDocument()
  })

  it('"Try again" sends the same request with the same key, and the transfer goes through once', async () => {
    const { user } = await sendUnconfirmed({ tracking: { giveUpAfterMs: 150 } })
    await screen.findByRole('heading', { name: 'We still can’t confirm this transfer' }, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Transfer on its way' }, { timeout: 5000 })).toBeInTheDocument()
    expect(postKeys).toHaveLength(2)
    expect(postKeys[1]).toBe(postKeys[0])
  })

  it('"Check status" goes back to checking', async () => {
    const { user } = await sendUnconfirmed({ tracking: { giveUpAfterMs: 150 } })
    await screen.findByRole('heading', { name: 'We still can’t confirm this transfer' }, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: 'Check status' }))
    expect(await screen.findByRole('heading', { name: 'We’re confirming this transfer' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('shows a transfer restored after a reload without its details, and cannot try it again', async () => {
    const { store } = renderWizard({ tracking: { giveUpAfterMs: 150 } })
    act(() => { store.dispatch(transferDraft.attemptRestored({ idempotencyKey: KEY })) })
    expect(await screen.findByRole('heading', { name: 'We’re confirming this transfer' })).toBeInTheDocument()
    expect(screen.getByText(/A transfer from before the page reloaded wasn’t confirmed/)).toBeInTheDocument()
    expect(screen.queryByText('Recipient')).not.toBeInTheDocument()
    await screen.findByRole('heading', { name: 'We still can’t confirm this transfer' }, { timeout: 5000 })
    expect(screen.getByRole('button', { name: 'Check status' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })
})

describe('Send Money — offline (ADR-0014)', () => {
  it('keeps Send reachable but refuses it while offline, says why, and sends once the connection is back', async () => {
    const { user, store, container } = renderWizard()
    await fillRecipient(user)
    await fillAmount(user, '5,000')
    await screen.findByRole('heading', { name: 'Review and send' })

    act(() => { store.dispatch(connectivity.connectionChanged({ online: false })) })
    const send = screen.getByRole('button', { name: 'Send ₦5,000.00' })
    expect(send).toHaveAttribute('aria-disabled', 'true')
    expect(send).toHaveAccessibleDescription(/You’re offline. Your details are kept/)
    expect(await axeViolations(container)).toEqual([])

    await user.click(send)
    await waitFor(() => expect(assertive()).toHaveTextContent('You’re offline. Your transfer will be ready to send when you’re back online.'))
    expect(postKeys).toEqual([])
    expect(screen.getByRole('heading', { name: 'Review and send' })).toBeInTheDocument()

    act(() => { store.dispatch(connectivity.connectionChanged({ online: true })) })
    expect(send).not.toHaveAttribute('aria-disabled')
    await user.click(send)
    expect(await screen.findByRole('heading', { name: 'Transfer on its way' }, { timeout: 5000 })).toBeInTheDocument()
    expect(postKeys).toHaveLength(1)
  })

  it('on a transfer that needs attention, Try again and Check status do nothing while offline, and say why', async () => {
    const { user, store } = renderWizard({ tracking: { giveUpAfterMs: 150 } })
    // Stand in for an unconfirmed transfer that reconciliation gave up on: what matters here is the receipt's buttons.
    act(() => {
      store.dispatch(transferDraft.attemptStarted({ idempotencyKey: KEY, request: SendMoneyRequestSchema.parse({ recipient: { accountNumber: '0123456789', bankCode: '058', accountName: 'Ngozi Okafor' }, amountKobo: 500_000 }) }))
      store.dispatch(connectivity.connectionChanged({ online: false }))
      store.dispatch(transferDraft.attemptUnknown({ idempotencyKey: KEY }))
      store.dispatch(transferDraft.attemptNeedsAttention({ idempotencyKey: KEY }))
    })
    await screen.findByRole('heading', { name: 'We still can’t confirm this transfer' })
    const postsBefore = postKeys.length

    for (const name of ['Try again', 'Check status']) {
      const button = screen.getByRole('button', { name })
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button).toHaveAccessibleDescription(/You’re offline. You can check or try again when you’re back online./)
      await user.click(button)
    }
    expect(postKeys).toHaveLength(postsBefore)
    expect(store.getState().transferDraft.attempt).toMatchObject({ status: 'unknown', needsAttention: true })
  })
})

describe('Send Money — account number input', () => {
  it('ignores anything that is not a digit, and the counter counts only digits', async () => {
    const { user } = renderWizard()
    const field = screen.getByLabelText('Account number')
    await user.type(field, 'dddd')
    expect(field).toHaveValue('')
    expect(screen.getByText('0/10')).toBeInTheDocument()

    await user.type(field, '01a2-3 4')
    expect(field).toHaveValue('01234')
    expect(screen.getByText('5/10')).toBeInTheDocument()
  })

  it('keeps every digit of a pasted number written with spaces', async () => {
    const { user } = renderWizard()
    const field = screen.getByLabelText('Account number')
    await user.click(field)
    await user.paste('0123 456 789')
    expect(field).toHaveValue('0123456789')
  })
})

describe('Send Money — amount input', () => {
  it('ignores letters and groups thousands while typing', async () => {
    const { user } = renderWizard()
    await fillRecipient(user)
    const field = screen.getByLabelText('Amount in naira')
    await user.type(field, 'pppp')
    expect(field).toHaveValue('')
    await user.type(field, '899889')
    expect(field).toHaveValue('899,889')
    await user.type(field, '.5x0')
    expect(field).toHaveValue('899,889.50')
  })

  it('puts a digit typed in the middle where the caret was', async () => {
    const { user } = renderWizard()
    await fillRecipient(user)
    const field = screen.getByLabelText('Amount in naira') as HTMLInputElement
    await user.type(field, '10000')
    expect(field).toHaveValue('10,000')
    // Caret after the "1", then type 5: 150,000.
    field.setSelectionRange(1, 1)
    await user.keyboard('5')
    expect(field).toHaveValue('150,000')
    expect(field.selectionStart).toBe(2)
  })

  it('Backspace or Delete next to a comma removes the digit beside it, not just the comma', async () => {
    const { user } = renderWizard()
    await fillRecipient(user)
    const field = screen.getByLabelText('Amount in naira') as HTMLInputElement
    await user.type(field, '899889')
    expect(field).toHaveValue('899,889')

    field.setSelectionRange(4, 4) // right after the comma
    await user.keyboard('{Backspace}')
    expect(field).toHaveValue('89,889')
    expect(field.selectionStart).toBe(2)

    field.setSelectionRange(2, 2) // right before the comma
    await user.keyboard('{Delete}')
    expect(field).toHaveValue('8,989')
  })

  it('refuses a typed comma instead of reading 5000,50 as 500,050, and says why', async () => {
    const { user } = renderWizard()
    await fillRecipient(user)
    const field = screen.getByLabelText('Amount in naira')
    await user.type(field, '5000,')
    expect(field).toHaveValue('5,000')
    expect(field).toHaveAccessibleDescription(/Use a point for kobo, like 5,000.50/)
    await waitFor(() => expect(assertive()).toHaveTextContent('Use a point for kobo, like 5,000.50'))

    await user.type(field, '.50')
    expect(field).toHaveValue('5,000.50')
    expect(field).not.toHaveAccessibleDescription(/Use a point for kobo/)
  })

  it('refuses a pasted amount it would have to guess at, keeping the field as it was', async () => {
    const { user } = renderWizard()
    await fillRecipient(user)
    const field = screen.getByLabelText('Amount in naira')
    await user.click(field)
    await user.paste('1,000.505')
    expect(field).toHaveValue('')
    expect(field).toHaveAccessibleDescription(/Enter an amount in naira, like 5,000 or 5,000.50/)
  })

  it('refuses a second point typed mid-number, keeping the decimals', async () => {
    const { user } = renderWizard()
    await fillRecipient(user)
    const field = screen.getByLabelText('Amount in naira') as HTMLInputElement
    await user.type(field, '1000.50')
    field.setSelectionRange(1, 1)
    await user.keyboard('.')
    expect(field).toHaveValue('1,000.50')
    expect(field).toHaveAccessibleDescription(/The amount already has a point/)
  })

  it('keeps the zeros when the first digit is deleted, so the next digit restores the amount', async () => {
    const { user } = renderWizard()
    await fillRecipient(user)
    const field = screen.getByLabelText('Amount in naira') as HTMLInputElement
    await user.type(field, '1000000')
    field.setSelectionRange(1, 1)
    await user.keyboard('{Backspace}2')
    expect(field).toHaveValue('2,000,000')
  })
})

describe('Send Money — account number input, review findings', () => {
  it('keeps the caret where it was when a letter is typed in the middle', async () => {
    const { user } = renderWizard()
    const field = screen.getByLabelText('Account number') as HTMLInputElement
    await user.type(field, '012345')
    field.setSelectionRange(2, 2)
    await user.keyboard('x9')
    expect(field).toHaveValue('0192345')
    expect(field.selectionStart).toBe(3)
  })

  it('refuses a paste that would not fit, rather than silently dropping digits', async () => {
    const { user } = renderWizard()
    const field = screen.getByLabelText('Account number')
    await user.type(field, '01234')
    await user.paste('567890123')
    expect(field).toHaveValue('01234')
    expect(field).toHaveAccessibleDescription(/An account number has 10 digits/)
  })
})
