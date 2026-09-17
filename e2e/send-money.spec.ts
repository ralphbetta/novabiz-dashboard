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
  shownAvailableKobo,
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
    await openApp(page, '/dashboard')
    const shownBefore = await shownAvailableKobo(page)
    const serverBefore = await serverAvailableKobo(page)
    await navigate(page, 'Transactions')
    await expect(page.getByText(/^1–25 of /)).toBeVisible() // the table's first page is now in the app's cache

    await navigate(page, 'Send money')
    await fillTransfer(page, AMOUNT)
    await armNextTransferInPanel(page, 'Timeout, money sent')
    const key = nextTransferKey(page)
    await page.getByRole('button', { name: `Send ₦1,000.50` }).click()
    await key // the transfer is on its way to the mock, which has already decided how to answer it
    // Slow the mock's later answers, so the app's checks take long enough to look at it while the outcome is unknown.
    await setMockLatency(page, 6_000)
    await expect(page.getByRole('heading', { name: 'We’re confirming this transfer' })).toBeVisible({ timeout: CLIENT_TIMEOUT })

    // While unknown, the balance the merchant sees stays reduced — the pessimistic reading (ADR-0006).
    await navigate(page, 'Dashboard')
    expect(await shownAvailableKobo(page)).toBe(shownBefore - AMOUNT_KOBO)
    // And the row stays, labelled as not yet confirmed.
    await navigate(page, 'Transactions')
    const row = page.getByRole('row').filter({ hasText: `Transfer to ${RECIPIENT.name}` }).first()
    await expect(row).toContainText('Awaiting confirmation')
    await expect(page.getByText('We’re confirming a transfer.')).toBeVisible()
    // The server has the transfer, although the app was never told.
    expect(await ledgerFor(page, await key)).toHaveLength(1)

    // Reconciliation finds it: the notice goes, the row is no longer awaiting, and it settles.
    await expect(page.getByText('We’re confirming a transfer.')).toBeHidden({ timeout: 30_000 })
    await expect(row).not.toContainText('Awaiting confirmation')
    await setMockLatency(page, 0)
    await expect.poll(async () => (await ledgerFor(page, await key)).map((r) => r.status), { timeout: 30_000 }).toEqual(['successful'])
    // Taken once: no second transfer under any key.
    expect(await serverAvailableKobo(page)).toBe(serverBefore - AMOUNT_KOBO)
    await navigate(page, 'Send money')
    await expect(page.getByRole('heading', { name: 'Transfer successful' })).toBeVisible()
  })

  test('1 happy path: ₦1,000.50 appears as pending at once, settles, and moves the balance by exactly 100,050 kobo', async ({ page }) => {
    await openApp(page, '/dashboard/transactions')
    await expect(page.getByText(/^1–25 of /)).toBeVisible() // the table's first page is in the app's cache
    const before = await serverAvailableKobo(page)
    await navigate(page, 'Send money')
    await fillTransfer(page, AMOUNT)

    // A slow reply, so the optimistic row can be seen before the server answers.
    await setMockLatency(page, 3_000)
    const key = nextTransferKey(page)
    await page.getByRole('button', { name: 'Send ₦1,000.50' }).click()
    await key
    await navigate(page, 'Transactions')
    const row = page.getByRole('row').filter({ hasText: `Transfer to ${RECIPIENT.name}` }).first()
    await expect(row).toContainText('Pending')
    await expect(row).toContainText('Processing') // the optimistic row's reference, before the server's arrives
    // Only now back to normal: resetting earlier can reach the mock before it has handled the transfer.
    await setMockLatency(page, 0)
    await expect(row).toContainText('Successful', { timeout: 30_000 })

    await navigate(page, 'Send money')
    await expect(page.getByRole('heading', { name: 'Transfer successful' })).toBeVisible()
    expect(await ledgerFor(page, await key)).toEqual([expect.objectContaining({ status: 'successful', amountKobo: AMOUNT_KOBO })])
    expect(await serverAvailableKobo(page)).toBe(before - AMOUNT_KOBO)

    await navigate(page, 'Dashboard')
    const recent = page.getByRole('table', { name: 'Recent transactions' })
    await expect(recent.getByRole('row').first()).toContainText(`Transfer to ${RECIPIENT.name}`)
    await expect(recent.getByRole('row').first()).toContainText('-₦1,000.50')
  })

  test('2 a definite failure: the server refuses, the row is removed, the balance is not left reduced, and it is announced', async ({ page }) => {
    await openApp(page, '/dashboard')
    const shownBefore = await shownAvailableKobo(page)
    await navigate(page, 'Transactions')
    const range = page.getByText(/^1–25 of /)
    await expect(range).toBeVisible()
    const rangeBefore = await range.textContent()
    await navigate(page, 'Send money')
    await fillTransfer(page, AMOUNT)

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
    await expect(range).toHaveText(rangeBefore ?? '') // the page's count is back where it was: no row left behind

    // The shown balance is not reduced by the refused transfer. It may be the figure from before, restored, or a fresh
    // one from the server (which the outside transfer lowered); either is right, a reduction by ₦1,000.50 is not.
    await navigate(page, 'Dashboard')
    const shownAfter = await shownAvailableKobo(page)
    expect(shownAfter).not.toBe(shownBefore - AMOUNT_KOBO)
    expect([shownBefore, await serverAvailableKobo(page)]).toContain(shownAfter)
  })

  test('4 "Try again" after an unconfirmed transfer does not send it twice', async ({ page }, testInfo) => {
    // About two minutes of real reconciliation before "Try again" appears: run it once, at desktop size.
    test.skip(testInfo.project.name !== 'desktop', 'Waits out real reconciliation timings; one viewport is enough')
    // 15s client timeout + about two minutes of checking (paused time excluded) + the retry, with room for a slow machine.
    test.setTimeout(300_000)
    await openApp(page, '/dashboard/send-money')
    const before = await serverAvailableKobo(page)
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
    expect(await serverAvailableKobo(page)).toBe(before - AMOUNT_KOBO) // and no transfer under any other key
  })

  test('5 offline mid-send: checking waits for the connection, then resolves without a duplicate', async ({ page, context }) => {
    test.slow()
    await openApp(page, '/dashboard/send-money')
    const before = await serverAvailableKobo(page)
    await fillTransfer(page, AMOUNT)
    await armNextTransfer(page, 'timeout-after-commit')
    const lookups = recordLookups(page)
    const key = nextTransferKey(page)
    await page.getByRole('button', { name: 'Send ₦1,000.50' }).click()
    await expect(page.getByRole('heading', { name: 'Sending your transfer…' })).toBeVisible()

    await context.setOffline(true)
    await expect(page.getByRole('heading', { name: 'We’re confirming this transfer' })).toBeVisible({ timeout: CLIENT_TIMEOUT })
    const whileOffline = lookups.count()
    // Without pausing, checks would come within 5s: the first gap is under 1s and the next under 2s (transferTracker.ts).
    await page.waitForTimeout(5_000)
    expect(lookups.count()).toBe(whileOffline) // no checks while there is no connection
    await expect(page.getByRole('heading', { name: 'We’re confirming this transfer' })).toBeVisible()

    await context.setOffline(false)
    await expect(page.getByRole('heading', { name: /Transfer (on its way|successful)/ })).toBeVisible({ timeout: 30_000 })
    expect(lookups.count()).toBeGreaterThan(whileOffline)
    expect(await ledgerFor(page, await key)).toHaveLength(1)
    expect(await serverAvailableKobo(page)).toBe(before - AMOUNT_KOBO) // no transfer under any other key
  })
})

test.describe('After a reload', () => {
  test('a sent transfer is still there, and so is the balance', async ({ page }) => {
    await openApp(page, '/dashboard/send-money')
    const before = await serverAvailableKobo(page)
    await fillTransfer(page, AMOUNT)
    const key = nextTransferKey(page)
    await page.getByRole('button', { name: 'Send ₦1,000.50' }).click()
    await expect(page.getByRole('heading', { name: 'Transfer successful' })).toBeVisible({ timeout: 30_000 })

    await page.reload()
    await page.waitForFunction(() => Boolean((window as Window & { novabizChaos?: unknown }).novabizChaos))
    expect(await ledgerFor(page, await key)).toEqual([expect.objectContaining({ status: 'successful' })])
    expect(await serverAvailableKobo(page)).toBe(before - AMOUNT_KOBO)
    await navigate(page, 'Dashboard')
    await expect(page.getByRole('table', { name: 'Recent transactions' }).getByRole('row').first()).toContainText('-₦1,000.50')
  })

  test('an unconfirmed transfer reloaded mid-check is found and settles', async ({ page }) => {
    test.slow()
    await openApp(page, '/dashboard/send-money')
    const before = await serverAvailableKobo(page)
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
    expect(await serverAvailableKobo(page)).toBe(before - AMOUNT_KOBO) // no transfer under any other key
  })
})

test.describe('Responsive smoke', () => {
  test('6 no page scrolls sideways', async ({ page }) => {
    await openApp(page, '/dashboard')
    await expect(page.getByRole('region', { name: 'Account overview' })).toBeVisible()
    expect(await hasHorizontalScroll(page)).toBe(false)
    await navigate(page, 'Transactions')
    await expect(page.getByRole('table', { name: /^Transactions, page 1/ }).getByRole('row').nth(1)).toBeVisible()
    expect(await hasHorizontalScroll(page), 'Transactions scrolls sideways').toBe(false)
    await navigate(page, 'Send money')
    await expect(page.getByRole('heading', { name: 'Who are you paying?' })).toBeVisible()
    expect(await hasHorizontalScroll(page), 'Send money scrolls sideways').toBe(false)
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

test.describe('Offline (Phase 7)', () => {
  test('offline: a banner says so, Send is refused with a reason, and the transfer goes once the connection is back', async ({ page, context }) => {
    await openApp(page, '/dashboard/send-money')
    const before = await serverAvailableKobo(page)
    await fillTransfer(page, AMOUNT)
    const posts = recordTransferPosts(page)

    await context.setOffline(true)
    const banner = page.getByRole('banner').getByRole('status')
    await expect(banner).toContainText('You’re offline.')
    const send = page.getByRole('button', { name: 'Send ₦1,000.50' })
    await expect(send).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByText('Your details are kept. You can send when you’re back online.')).toBeInViewport()
    // Playwright treats aria-disabled as disabled and would wait; a merchant can still tap it, so force the tap.
    await send.click({ force: true })
    await expect(page.getByRole('heading', { name: 'Review and send' })).toBeVisible()
    expect(posts).toEqual([]) // nothing sent, nothing queued

    await context.setOffline(false)
    await expect(banner).toContainText('You’re back online.')
    await expect(send).not.toHaveAttribute('aria-disabled')
    await send.click()
    await expect(page.getByRole('heading', { name: /Transfer (on its way|successful)/ })).toBeVisible({ timeout: CLIENT_TIMEOUT })
    expect(posts).toHaveLength(1)
    expect(await serverAvailableKobo(page)).toBe(before - AMOUNT_KOBO)
  })
})

test.describe('Dark mode (Phase 7)', () => {
  // No service worker, so nothing — including the mock's worker — can serve the app's scripts past the route block below.
  // Without the mock the app still renders its shell, which is all this test needs.
  test.use({ serviceWorkers: 'block' })

  test('dark mode: the choice is applied at once and still there after a reload, with no light flash', async ({ page }, testInfo) => {
    await page.goto('/dashboard')
    const html = page.locator('html')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(html).not.toHaveClass(/dark/) // the browser is set to light
    if (testInfo.project.name === 'mobile') {
      await page.getByRole('button', { name: 'Open menu' }).tap()
      await page.getByRole('dialog').getByRole('button', { name: 'Dark mode' }).tap()
    } else {
      await page.getByRole('banner').getByRole('button', { name: 'Dark mode' }).click()
    }
    await expect(html).toHaveClass(/dark/)

    // Reload with every script file blocked: only index.html's inline script can set the class.
    await page.route('**/*.js', (route) => route.abort())
    await page.reload()
    // Proof the app did not run: React replaces this placeholder as soon as it renders.
    await expect(page.locator('#root')).toHaveText('Loading NovaBiz…')
    await expect(html).toHaveClass(/dark/)
  })
})
