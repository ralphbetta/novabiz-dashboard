import { describe, it, expect } from 'vitest'
import { ESLint } from 'eslint'

/**
 * ADR-0002 relies on a lint rule, not the branded type, to stop kobo↔naira conversion
 * leaking into components. A guard that silently stops matching is worse than none, so
 * assert it actually fires.
 */
const eslint = new ESLint()
const lint = async (code: string, filePath: string) => {
  const [result] = await eslint.lintText(code, { filePath })
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-syntax')
}

describe('money lint guard', () => {
  const component = 'src/components/BalanceCard.tsx'

  it.each([
    ['division', 'export const a = (x: number) => x / 100'],
    ['multiplication', 'export const a = (x: number) => x * 100'],
    ['reversed multiplication', 'export const a = (x: number) => 100 * x'],
    ['compound division', 'export function a(x: number) { x /= 100; return x }'],
    ['toFixed', 'export const a = (x: number) => x.toFixed(2)'],
    ['multiplication by 0.01', 'export const a = (x: number) => x * 0.01'],
    ['reversed multiplication by 0.01', 'export const a = (x: number) => 0.01 * x'],
    ['division by 0.01', 'export const a = (x: number) => x / 0.01'],
  ])('flags %s outside the money module', async (_label, code) => {
    expect(await lint(code, component)).toHaveLength(1)
  })

  it('does not flag unrelated arithmetic', async () => {
    expect(await lint('export const a = (x: number) => x / 2 + x * 1000', component)).toHaveLength(0)
  })

  it('permits conversion inside the money module', async () => {
    expect(await lint('export const a = (x: number) => x / 100', 'src/lib/money.ts')).toHaveLength(0)
  })

  // These are NOT caught, and ADR-0002 says so. Pinned so that the docs and the rule cannot
  // drift apart: if the rule is widened to catch one, this fails and the ADR must be updated.
  it.each([
    ['a named constant divisor', 'const K = 100\nexport const a = (x: number) => x / K'],
    ['chained division', 'export const a = (x: number) => x / 10 / 10'],
  ])('KNOWN GAP — does not catch %s', async (_label, code) => {
    expect(await lint(code, component)).toHaveLength(0)
  })

  it('flags dangerouslySetInnerHTML (ADR-0013)', async () => {
    const code = 'export const A = ({ d }: { d: string }) => <p dangerouslySetInnerHTML={{ __html: d }} />'
    expect(await lint(code, component)).toHaveLength(1)
  })
})
