/**
 * Helpers for the Send Money end-to-end tests: moving around the app as a merchant would, and reading the mock server's
 * ledger directly, so a test asserts what the server recorded rather than only what the screen says (ADR-0011).
 */
import { expect, type Page, type Request } from '@playwright/test'

/** A recipient the mock's directory knows (src/mocks/directory.ts). */
export const RECIPIENT = { accountNumber: '0123456789', bank: 'Guaranty Trust Bank', name: 'Ngozi Okafor' }

type ForcedTransferOutcome = 'success' | 'error-before-commit' | 'error-after-commit' | 'timeout-before-commit' | 'timeout-after-commit'
type MockWindow = Window & {
  novabizChaos?: {
    forceNextTransfer: (outcome: ForcedTransferOutcome | null) => void
    update: (settings: Record<string, number>) => void
  }
}
interface LedgerRow { idempotencyKey: string | null; status: string; amountKobo: number; description: string }

/** Opens a page and waits until the mock API is running. */
export async function openApp(page: Page, path = '/dashboard') {
  await page.goto(path)
  await page.waitForFunction(() => Boolean((window as MockWindow).novabizChaos), null, { timeout: 30_000 })
}

/** Follows a main navigation link, through the menu drawer on narrow screens — keeping the app's in-memory cache. */
export async function navigate(page: Page, name: 'Dashboard' | 'Transactions' | 'Send money') {
  const menu = page.getByRole('button', { name: 'Open menu' })
  if (await menu.isVisible()) {
    await menu.click()
    await page.getByRole('dialog').getByRole('link', { name, exact: true }).click()
  } else {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true }).click()
  }
  await expect(page.locator('main h1')).toBeAttached()
}

/** Fills Send Money up to the review step. Returns the available balance the amount step showed. */
export async function fillTransfer(page: Page, amount: string): Promise<string> {
  await page.getByLabel('Account number').fill(RECIPIENT.accountNumber)
  await page.getByRole('combobox', { name: 'Bank' }).click()
  await page.getByRole('option', { name: RECIPIENT.bank }).click()
  await expect(page.locator('form [role="status"]')).toContainText(`Account verified: ${RECIPIENT.name}`)
  await page.getByRole('button', { name: 'Continue' }).click()

  const hint = page.getByText(/^Available balance:/)
  await expect(hint).toBeVisible()
  const available = ((await hint.textContent()) ?? '').replace('Available balance:', '').trim()
  await page.getByLabel('Amount in naira').fill(amount)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Review and send' })).toBeVisible()
  return available
}

/** Arms what the next transfer does, through the Mock API panel, as a reviewer would. */
export async function armNextTransferInPanel(page: Page, label: string) {
  await page.getByRole('button', { name: /^Mock API/ }).click()
  const panel = page.getByRole('dialog', { name: 'Mock API controls' })
  await panel.getByText(label, { exact: true }).click()
  await expect(panel.getByRole('radio', { name: new RegExp(label) })).toBeChecked()
  await panel.getByRole('button', { name: 'Close Mock API controls' }).click()
  await expect(panel).toBeHidden()
}

export async function armNextTransfer(page: Page, outcome: ForcedTransferOutcome) {
  await page.evaluate((o) => (window as MockWindow).novabizChaos?.forceNextTransfer(o), outcome)
}

export async function setMockLatency(page: Page, latencyMs: number) {
  await page.evaluate((ms) => (window as MockWindow).novabizChaos?.update({ latencyMs: ms, jitterMs: 0 }), latencyMs)
}

const isTransferPost = (request: Request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/transfers'

/** Resolves to the Idempotency-Key of the next transfer the app sends. Start waiting before pressing Send. */
export function nextTransferKey(page: Page): Promise<string> {
  return page.waitForRequest(isTransferPost).then((request) => request.headers()['idempotency-key'] ?? '')
}

/** Every transfer POST the page sends, with its key. */
export function recordTransferPosts(page: Page): string[] {
  const keys: string[] = []
  page.on('request', (request) => { if (isTransferPost(request)) keys.push(request.headers()['idempotency-key'] ?? '') })
  return keys
}

/** Every reconciliation lookup the page sends. */
export function recordLookups(page: Page): { count: () => number } {
  let count = 0
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname === '/api/transfers' && url.searchParams.has('idempotencyKey')) count++
  })
  return { count: () => count }
}

/** The available balance the mock server holds, in kobo. */
export async function serverAvailableKobo(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const response = await fetch('/api/balance')
    const body = (await response.json()) as { availableBalanceKobo: number }
    return body.availableBalanceKobo
  })
}

/** The mock server's ledger rows for one idempotency key. */
export async function ledgerFor(page: Page, idempotencyKey: string): Promise<LedgerRow[]> {
  return page.evaluate(async (key) => {
    const response = await fetch('/api/transactions?limit=1000')
    const body = (await response.json()) as { items: LedgerRow[] }
    return body.items.filter((row) => row.idempotencyKey === key)
  }, idempotencyKey)
}

/** Makes a transfer directly against the mock, outside the app — as if from another device. */
export async function transferOutsideApp(page: Page, amountKobo: number) {
  const status = await page.evaluate(async (amount) => {
    const response = await fetch('/api/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        recipient: { accountNumber: '0987654321', bankCode: '044', accountName: 'Oyingbo Foodstuff Traders' },
        amountKobo: amount,
      }),
    })
    return response.status
  }, amountKobo)
  expect(status).toBe(202)
}

/** True when the page scrolls sideways — content wider than the screen. */
export async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
}
