/**
 * Send Money, end to end (ADR-0011, layer 3). The flows that must never break, each at 360px and 1440px unless noted.
 *
 * Money is asserted against the mock server's ledger — by idempotency key, in kobo — not only against text on screen.
 */
import { expect, test } from '@playwright/test'
import {
  RECIPIENT,
  armNextTransfer,
  armNextTransferInPanel,
  fillTransfer,
  hasHorizontalScroll,
  ledgerFor,
  navigate,
  nextTransferKey,
  openApp,
  recordLookups,
  recordTransferPosts,
  serverAvailableKobo,
  setMockLatency,
  transferOutsideApp,
} from './support'

const AMOUNT = '1000.50'
const AMOUNT_KOBO = 100_050
/** The client gives up on a request after 15s; a forced timeout needs that long before the receipt changes. */
const CLIENT_TIMEOUT = 30_000

test.describe('Send Money', () => {
  test('3 ⭐ a timeout on a transfer the server DID record: kept, awaiting confirmation, then settled — exactly once', async ({ page }) => {
    // The test that fails if someone "simplifies" ADR-0006 back to snapshot-and-restore.
    test.slow()
    await openApp(page, '/dashboard/transactions')
    await expect(page.getByText(/^1–25 of /)).toBeVisible() // the table's first page is now in the app's cache
    const before = await serverAvailableKobo(page)

    await navigate(page, 'Send money')
    await fillTransfer(page, AMOUNT)
    await armNextTransferInPanel(page, 'Timeout, money sent')
    const key = nextTransferKey(page)
    await page.getByRole('button', { name: `Send ₦1,000.50` }).click()
    await key // the transfer is on its way to the mock, which has already decided how to answer it
    // Slow the mock's later answers, so the app's checks take long enough to look at it while the outcome is unknown.
    await setMockLatency(page, 6_000)

    await expect(page.getByRole('heading', { name: 'We’re confirming this transfer' })).toBeVisible({ timeout: CLIENT_TIMEOUT })
    await navigate(page, 'Transactions')
    const row = page.getByRole('row').filter({ hasText: `Transfer to ${RECIPIENT.name}` }).first()
    await expect(row).toContainText('Awaiting confirmation') // not removed, and not claimed as pending
    await expect(page.getByText('We’re confirming a transfer.')).toBeVisible()
    // The server has the transfer, although the app was never told.
    expect(await ledgerFor(page, await key)).toHaveLength(1)

    // Reconciliation finds it: the notice goes, the row is no longer awaiting, and it settles.
    await expect(page.getByText('We’re confirming a transfer.')).toBeHidden({ timeout: 30_000 })
    await expect(row).not.toContainText('Awaiting confirmation')
    await setMockLatency(page, 0)
    await expect.poll(async () => (await ledgerFor(page, await key)).map((r) => r.status), { timeout: 30_000 }).toEqual(['successful'])
    // The balance was never restored and never taken twice.
    expect(await serverAvailableKobo(page)).toBe(before - AMOUNT_KOBO)
    await navigate(page, 'Send money')
    await expect(page.getByRole('heading', { name: 'Transfer successful' })).toBeVisible()
  })

  test('1 happy path: ₦1,000.50 is sent, appears, settles, and moves the balance by exactly 100,050 kobo', async ({ page }) => {
    await openApp(page, '/dashboard/send-money')
    const before = await serverAvailableKobo(page)
    await fillTransfer(page, AMOUNT)
    const key = nextTransferKey(page)
    await page.getByRole('button', { name: 'Send ₦1,000.50' }).click()

    await expect(page.getByRole('heading', { name: 'Transfer successful' })).toBeVisible({ timeout: 30_000 })
    expect(await ledgerFor(page, await key)).toEqual([expect.objectContaining({ status: 'successful', amountKobo: AMOUNT_KOBO })])
    expect(await serverAvailableKobo(page)).toBe(before - AMOUNT_KOBO)

    await navigate(page, 'Dashboard')
    const recent = page.getByRole('table', { name: 'Recent transactions' })
    await expect(recent.getByRole('row').first()).toContainText(`Transfer to ${RECIPIENT.name}`)
    await expect(recent.getByRole('row').first()).toContainText('-₦1,000.50')
  })

  test('2 a definite failure: the server refuses, the row is removed, the balance is restored, and it is announced', async ({ page }) => {
    await openApp(page, '/dashboard/transactions')
    await expect(page.getByText(/^1–25 of /)).toBeVisible()
    await navigate(page, 'Send money')
    const shownBefore = await fillTransfer(page, AMOUNT)

    // Elsewhere, almost everything is spent; the app does not know, so its own check passes and the server refuses.
    await transferOutsideApp(page, (await serverAvailableKobo(page)) - 10_000)
    const key = nextTransferKey(page)
    await page.getByRole('button', { name: 'Send ₦1,000.50' }).click()

    await expect(page.getByRole('heading', { name: 'Transfer not sent' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('alert').filter({ hasText: 'Transfer not sent' })).toContainText('Insufficient funds for this transfer. Nothing was sent.')
    expect(await ledgerFor(page, await key)).toEqual([])

    await navigate(page, 'Transactions')
    await expect(page.getByRole('table', { name: /^Transactions, page 1/ })).toBeVisible()
    await expect(page.getByText('Awaiting confirmation')).toHaveCount(0)
    await expect(page.getByRole('row').filter({ hasText: '-₦1,000.50' })).toHaveCount(0)
    await expect(page.getByText(/^1–25 of /)).toBeVisible() // no extra row left on the page

    await navigate(page, 'Dashboard')
    await expect(page.getByRole('region', { name: 'Account overview' })).toContainText(shownBefore)
  })

  test('4 "Try again" after an unconfirmed transfer does not send it twice', async ({ page }, testInfo) => {
    // About two minutes of real reconciliation before "Try again" appears: run it once, at desktop size.
    test.skip(testInfo.project.name !== 'desktop', 'Waits out real reconciliation timings; one viewport is enough')
    test.setTimeout(240_000)
    await openApp(page, '/dashboard/send-money')
    await fillTransfer(page, AMOUNT)
    await armNextTransfer(page, 'timeout-before-commit') // the first attempt never reaches the ledger
    const posts = recordTransferPosts(page)
    await page.getByRole('button', { name: 'Send ₦1,000.50' }).click()

    await expect(page.getByRole('heading', { name: 'We’re confirming this transfer' })).toBeVisible({ timeout: CLIENT_TIMEOUT })
    await expect(page.getByRole('heading', { name: 'We still can’t confirm this transfer' })).toBeVisible({ timeout: 180_000 })
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('heading', { name: /Transfer (on its way|successful)/ })).toBeVisible({ timeout: 30_000 })

    expect(posts).toHaveLength(2)
    expect(posts[1]).toBe(posts[0]) // the same key both times
    expect(await ledgerFor(page, posts[0] ?? '')).toHaveLength(1)
  })

  test('5 offline mid-send: checking waits for the connection, then resolves without a duplicate', async ({ page, context }) => {
    test.slow()
    await openApp(page, '/dashboard/send-money')
    await fillTransfer(page, AMOUNT)
    await armNextTransfer(page, 'timeout-after-commit')
    const lookups = recordLookups(page)
    const key = nextTransferKey(page)
    await page.getByRole('button', { name: 'Send ₦1,000.50' }).click()
    await expect(page.getByRole('heading', { name: 'Sending your transfer…' })).toBeVisible()

    await context.setOffline(true)
    await expect(page.getByRole('heading', { name: 'We’re confirming this transfer' })).toBeVisible({ timeout: CLIENT_TIMEOUT })
    const whileOffline = lookups.count()
    await page.waitForTimeout(4_000)
    expect(lookups.count()).toBe(whileOffline) // no checks while there is no connection
    await expect(page.getByRole('heading', { name: 'We’re confirming this transfer' })).toBeVisible()

    await context.setOffline(false)
    await expect(page.getByRole('heading', { name: /Transfer (on its way|successful)/ })).toBeVisible({ timeout: 30_000 })
    expect(lookups.count()).toBeGreaterThan(whileOffline)
    expect(await ledgerFor(page, await key)).toHaveLength(1)
  })
})

test.describe('After a reload', () => {
  test('a sent transfer is still there, and so is the balance', async ({ page }) => {
    await openApp(page, '/dashboard/send-money')
    await fillTransfer(page, AMOUNT)
    const key = nextTransferKey(page)
    await page.getByRole('button', { name: 'Send ₦1,000.50' }).click()
    await expect(page.getByRole('heading', { name: 'Transfer successful' })).toBeVisible({ timeout: 30_000 })
    const after = await serverAvailableKobo(page)

    await page.reload()
    await page.waitForFunction(() => Boolean((window as Window & { novabizChaos?: unknown }).novabizChaos))
    expect(await ledgerFor(page, await key)).toEqual([expect.objectContaining({ status: 'successful' })])
    expect(await serverAvailableKobo(page)).toBe(after)
    await navigate(page, 'Dashboard')
    await expect(page.getByRole('table', { name: 'Recent transactions' }).getByRole('row').first()).toContainText('-₦1,000.50')
  })

  test('an unconfirmed transfer reloaded mid-check is found and settles', async ({ page }) => {
    test.slow()
    await openApp(page, '/dashboard/send-money')
    await fillTransfer(page, AMOUNT)
    await armNextTransfer(page, 'timeout-after-commit')
    const key = nextTransferKey(page)
    await page.getByRole('button', { name: 'Send ₦1,000.50' }).click()
    await key
    await setMockLatency(page, 6_000) // keep the first check slow, so the reload happens while it is still unknown
    await expect(page.getByRole('heading', { name: 'We’re confirming this transfer' })).toBeVisible({ timeout: CLIENT_TIMEOUT })

    await page.reload()
    // Only the key survived the reload; the receipt comes back without the details, and checking resumes.
    await expect(page.getByText(/A transfer from before the page reloaded wasn’t confirmed/)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('heading', { name: /Transfer (on its way|successful)/ })).toBeVisible({ timeout: 30_000 })
    expect(await ledgerFor(page, await key)).toHaveLength(1)
  })
})

test.describe('Responsive smoke', () => {
  test('6 no page scrolls sideways', async ({ page }) => {
    await openApp(page, '/dashboard')
    await expect(page.getByRole('region', { name: 'Account overview' })).toBeVisible()
    expect(await hasHorizontalScroll(page)).toBe(false)
    for (const name of ['Transactions', 'Send money'] as const) {
      await navigate(page, name)
      await expect(page.locator('main h1')).toBeAttached()
      await page.waitForLoadState('networkidle')
      expect(await hasHorizontalScroll(page), `${name} scrolls sideways`).toBe(false)
    }
  })

  test('the menu drawer closes with its close button (a layout bug jsdom cannot see)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'The drawer exists below 1024px')
    await openApp(page, '/dashboard')
    await page.getByRole('button', { name: 'Open menu' }).tap()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    await drawer.getByRole('button', { name: 'Close menu' }).tap()
    await expect(drawer).toBeHidden()
  })
})
