import { defineConfig } from 'vitest/config'

// Deliberately separate from vite.config.ts: unit tests for src/lib are pure logic and
// do not need the React Compiler babel pass, which would slow every run for no benefit.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: { reporter: ['text', 'html'], include: ['src/lib/**'] },
  },
})
