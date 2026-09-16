/**
 * Shared test setup. Component tests opt into a browser-like environment per file with
 * `// @vitest-environment jsdom`; logic tests stay on plain Node, which is faster.
 */
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
