/**
 * Accessibility in a real browser (ADR-0012): axe on every page and the states that matter, in both themes, at 360px and
 * 1440px. Unlike the component tests in jsdom, this checks colour contrast on the rendered page — what actually overlaps.
 *
 * axe finds a subset of problems. It does not replace a keyboard walkthrough or a screen reader run.
 */
import { expect, test, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import { RECIPIENT, fillTransfer, navigate, openApp } from './support'

const AXE_PATH = createRequire(import.meta.url).resolve('axe-core/axe.min.js')

/** Runs axe on the page as it is now, against WCAG 2.1 A and AA. Returns one readable line per violation. */
async function axeViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: AXE_PATH })
  return page.evaluate(async () => {
    type AxeResult = { violations: { id: string; help: string; nodes: { target: string[] }[] }[] }
    const axe = (window as unknown as { axe: { run: (context: Document, options: object) => Promise<AxeResult> } }).axe
    const results = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
    return results.violations.map((v) => `${v.id}: ${v.help} — ${v.nodes.map((n) => n.target.join(' ')).slice(0, 5).join(', ')}`)
  })
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`Accessibility, ${colorScheme} theme`, () => {
    test.use({ colorScheme })

    test('dashboard, transactions and the 404 page', async ({ page }) => {
      await openApp(page, '/dashboard')
      await expect(page.getByTestId('available-balance')).toBeVisible()
      await expect(page.getByRole('table', { name: 'Recent transactions' })).toBeVisible()
      expect(await axeViolations(page), 'dashboard').toEqual([])

      await navigate(page, 'Transactions')
      await expect(page.getByRole('table', { name: /^Transactions, page 1/ }).getByRole('row').nth(1)).toBeVisible()
      expect(await axeViolations(page), 'transactions').toEqual([])

      await page.goto('/no-such-page')
      await expect(page.getByRole('heading', { name: 'We couldn’t find that page' })).toBeVisible()
      expect(await axeViolations(page), '404').toEqual([])
    })

    test('every Send Money step, and the receipt', async ({ page }) => {
      await openApp(page, '/dashboard/send-money')
      await expect(page.getByRole('heading', { name: 'Who are you paying?' })).toBeVisible()
      expect(await axeViolations(page), 'recipient, empty').toEqual([])

      await page.getByLabel('Account number').fill('9990000000')
      await page.getByRole('combobox', { name: 'Bank' }).click()
      expect(await axeViolations(page), 'bank list open').toEqual([])
      await page.getByRole('option', { name: RECIPIENT.bank }).click()
      await expect(page.locator('form [role="status"]')).toContainText('No account found')
      expect(await axeViolations(page), 'recipient, account not found').toEqual([])

      await page.getByLabel('Account number').fill('')
      await page.goto('/dashboard/send-money')
      await fillTransfer(page, '1000.50')
      expect(await axeViolations(page), 'review').toEqual([])

      await page.getByRole('button', { name: 'Send ₦1,000.50' }).click()
      await expect(page.getByRole('heading', { name: /Transfer (on its way|successful)/ })).toBeVisible({ timeout: 30_000 })
      expect(await axeViolations(page), 'receipt').toEqual([])
    })

    test('the amount step with an error, offline, the Mock API panel and the phone menu', async ({ page, context }) => {
      await openApp(page, '/dashboard/send-money')
      await page.getByLabel('Account number').fill(RECIPIENT.accountNumber)
      await page.getByRole('combobox', { name: 'Bank' }).click()
      await page.getByRole('option', { name: RECIPIENT.bank }).click()
      await expect(page.locator('form [role="status"]')).toContainText(`Account verified: ${RECIPIENT.name}`)
      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(page.getByText(/^Available balance:/)).toBeVisible()
      await page.getByRole('button', { name: 'Continue' }).click() // no amount
      await expect(page.getByLabel('Amount in naira')).toHaveAttribute('aria-invalid', 'true')
      expect(await axeViolations(page), 'amount with error').toEqual([])

      await context.setOffline(true)
      await expect(page.getByRole('banner').getByRole('status')).toContainText('You’re offline.')
      expect(await axeViolations(page), 'offline').toEqual([])
      await context.setOffline(false)

      await page.getByRole('button', { name: /^Mock API/ }).click()
      await expect(page.getByRole('dialog', { name: 'Mock API controls' })).toBeVisible()
      expect(await axeViolations(page), 'Mock API panel').toEqual([])
      await page.getByRole('button', { name: 'Close Mock API controls' }).click()

      const menu = page.getByRole('button', { name: 'Open menu' })
      if (await menu.isVisible()) {
        await menu.click()
        await expect(page.getByRole('dialog', { name: 'Main menu' })).toBeVisible()
        expect(await axeViolations(page), 'phone menu').toEqual([])
      }
    })
  })
}

test('after navigating, focus is on the new page’s heading — also now that pages load on demand', async ({ page }) => {
  await openApp(page, '/dashboard')
  await expect(page.getByTestId('available-balance')).toBeVisible()
  for (const [link, heading] of [['Transactions', 'Transactions'], ['Send money', 'Send money'], ['Dashboard', /^Good (morning|afternoon|evening)/]] as const) {
    await navigate(page, link)
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeFocused()
  }
})

test('Send Money works with the keyboard alone, and focus stays visible', async ({ page }) => {
  await openApp(page, '/dashboard/send-money')
  await expect(page.getByRole('heading', { name: 'Who are you paying?' })).toBeVisible()

  /** Presses Tab until `target` has focus, as a keyboard user would; fails if it is not reachable. */
  const tabTo = async (target: ReturnType<Page['getByRole']>) => {
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      if (await target.evaluate((el) => el === document.activeElement)) {
        // Every focused control shows an outline (ADR-0012): on itself, or — for a text field — around its box.
        const outlined = await target.evaluate((el) => {
          for (let node: Element | null = el, depth = 0; node && depth < 3; node = node.parentElement, depth++) {
            if (getComputedStyle(node).outlineStyle !== 'none') return true
          }
          return false
        })
        expect(outlined, 'focused control shows no outline').toBe(true)
        return
      }
    }
    throw new Error('not reachable with Tab')
  }

  await tabTo(page.getByLabel('Account number'))
  await page.keyboard.type('0123456789')
  await tabTo(page.getByRole('combobox', { name: 'Bank' }))
  await page.keyboard.press('Enter')
  await page.keyboard.type('Guaranty')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('combobox', { name: 'Bank' })).toHaveText(/Guaranty Trust Bank/)
  await expect(page.locator('form [role="status"]')).toContainText('Account verified: Ngozi Okafor')
  await tabTo(page.getByRole('button', { name: 'Continue' }))
  await page.keyboard.press('Enter')

  await expect(page.getByRole('heading', { name: 'How much are you sending?' })).toBeFocused()
  await expect(page.getByText(/^Available balance:/)).toBeVisible()
  await tabTo(page.getByLabel('Amount in naira'))
  await page.keyboard.type('1000.50')
  await tabTo(page.getByRole('button', { name: 'Continue' }))
  await page.keyboard.press('Enter')

  await expect(page.getByRole('heading', { name: 'Review and send' })).toBeFocused()
  await tabTo(page.getByRole('button', { name: 'Send ₦1,000.50' }))
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: /Transfer (on its way|successful)/ })).toBeVisible({ timeout: 30_000 })
})
