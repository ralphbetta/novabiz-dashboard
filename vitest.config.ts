import { defineConfig } from 'vitest/config'

// Deliberately separate from vite.config.ts: unit tests for src/lib are pure logic and
// do not need the React Compiler babel pass, which would slow every run for no benefit.
export default defineConfig({
  test: {
    environment: 'node',
    // The timeout exists to catch hangs, not to measure speed. On an idle machine the slowest test is
    // ~750ms (ESLint cold start in money.lint.test.ts) and the slowest property or pagination test is
    // under 250ms. The 5s default still timed out three tests on a heavily loaded machine running test
    // files in parallel, so it is raised rather than letting CPU starvation read as a failure.
    testTimeout: 20_000,
    include: ['src/**/*.test.ts'],
    coverage: { reporter: ['text', 'html'], include: ['src/lib/**'] },
  },
})
