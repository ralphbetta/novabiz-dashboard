import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests for Send Money (ADR-0011, layer 3), against the production build with the mock API.
 *
 * Every test gets a new browser context, so its own empty localStorage: the mock starts from the seed data each time.
 * Each flow runs at 360px and 1440px. Tests that must wait out real timings — the 15s client timeout, about two minutes
 * of reconciliation — say so with `test.slow()` or run on one viewport only.
 *
 * Browser: Playwright's own Chromium (`npx playwright install chromium`). Set PLAYWRIGHT_CHANNEL=chrome to use an
 * installed Google Chrome instead.
 */
const PORT = 4174
const channel = process.env.PLAYWRIGHT_CHANNEL

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // No retries: a flow that passes only on a second try is a finding, not a pass.
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    ...(channel ? { channel } : {}),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true } },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Always a fresh build: reusing a preview left running would test old code, and a check that breaks the code on
    // purpose would then wrongly pass.
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
