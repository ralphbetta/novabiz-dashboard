/**
 * WCAG AA contrast over the design tokens, in light and dark (ADR-0010, ADR-0012).
 *
 * axe cannot check contrast in jsdom (no layout or painting), so contrast is checked here instead. Text needs 4.5:1;
 * focus outlines and the boundaries of fields need 3:1.
 *
 * What this can and cannot prove. The pairs below are listed by hand from the components. The test does not work out
 * which colours end up on top of which: that needs a rendered page. What it does work out, from the CSS Tailwind
 * actually generates for this codebase, is that every text and background colour in use appears in at least one
 * checked pair, so a newly used colour cannot go unchecked.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from 'tailwindcss'
import { beforeAll, describe, it, expect } from 'vitest'

const stylesDir = dirname(fileURLToPath(import.meta.url))
const srcDir = join(stylesDir, '..')
const source = readFileSync(join(stylesDir, 'index.css'), 'utf8')

function tokens(selector: string): Record<string, string> {
  const start = source.search(new RegExp(`(^|\\n)${selector.replace('.', '\\.')}\\s*\\{`))
  if (start === -1) throw new Error(`No ${selector} block in index.css`)
  const body = source.slice(source.indexOf('{', start) + 1, source.indexOf('}', start))
  return Object.fromEntries([...body.matchAll(/--nb-([a-z-]+):\s*(#[0-9a-f]{6})\s*;/g)].map((m) => [m[1], m[2]]))
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

function sourceFiles(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path, pattern)
    return pattern.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

/**
 * The CSS Tailwind generates for this codebase. Candidates are every class-like word in the app's source and
 * index.html — a simpler split than Tailwind's own scanner, but Tailwind ignores words that are not classes, so
 * extra words cost nothing, and anything its scanner would find as a word is found here too.
 */
async function compiledCss(): Promise<string> {
  const require = createRequire(import.meta.url)
  const files = [...sourceFiles(srcDir, /\.(ts|tsx)$/), join(srcDir, '..', 'index.html')]
  const candidates = new Set(files.flatMap((file) => readFileSync(file, 'utf8').split(/[\s"'`{}<>;,=]+/)))
  const compiler = await compile(source, {
    base: stylesDir,
    loadStylesheet: async (id, base) => {
      const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id, { paths: [base] })
      return { path, base: dirname(path), content: readFileSync(path, 'utf8') }
    },
  })
  return compiler.build([...candidates])
}

/** Each generated utility rule: its selector and its declarations. */
function utilityRules(css: string): { selector: string; body: string }[] {
  const start = css.indexOf('@layer utilities')
  if (start === -1) throw new Error('No utilities layer in the compiled CSS')
  return [...css.slice(start).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: (m[1] ?? '').trim(), body: m[2] ?? '' }))
}

let css = ''
beforeAll(async () => { css = await compiledCss() })

/** Text colour on background, taken from the components by hand. */
const TEXT_PAIRS: [string, string][] = [
  ['fg', 'canvas'], ['fg', 'surface'], ['fg', 'surface-muted'],
  ['fg-muted', 'canvas'], ['fg-muted', 'surface'], ['fg-muted', 'surface-muted'],
  ['accent', 'canvas'], ['accent', 'surface'], ['accent', 'surface-muted'],
  ['accent-fg', 'accent'],
  ['brand-fg', 'brand'], ['brand-fg', 'brand-raised'],
  ['brand-fg-muted', 'brand'], ['brand-fg-muted', 'brand-raised'],
  ['brand', 'brand-fg'],
  ['debit', 'surface'],
  ['credit', 'surface'], ['credit', 'success-subtle'], ['credit', 'credit-subtle'],
  ['pending', 'surface'], ['pending', 'pending-subtle'],
  ['danger', 'canvas'], ['danger', 'surface'], ['danger', 'danger-subtle'],
]

/** Non-text: focus outlines, field boundaries, and the borders that mark a control as hovered or open. */
const UI_PAIRS: [string, string][] = [
  ['focus', 'canvas'], ['focus', 'surface'], ['focus', 'surface-muted'],
  // On the brand-blue sidebar and balance card the outline switches to focus-on-brand (the `surface-brand` utility).
  ['focus-on-brand', 'brand'], ['focus-on-brand', 'brand-raised'],
  // Text and date inputs: the border can be the only sign that a field is there, for example when it is empty.
  ['border-field', 'surface'], ['border-field', 'canvas'],
  ['border-strong', 'surface'], ['border-strong', 'canvas'],
  ['accent', 'surface'],
  ['danger', 'surface'],
]

/** Backgrounds that carry no text, so need no text pair. */
const DECORATIVE_BACKGROUNDS = new Set(['skeleton', 'border', 'fg'])

describe.each([
  ['light', ':root'],
  ['dark', '.dark'],
])('%s theme tokens', (_theme, selector) => {
  const t = tokens(selector)
  const hex = (name: string) => {
    const value = t[name]
    if (!value) throw new Error(`Token --nb-${name} is not defined in ${selector}`)
    return value
  }

  it.each(TEXT_PAIRS)('text %s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(hex(fg), hex(bg))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(UI_PAIRS)('%s against %s is at least 3:1', (fg, bg) => {
    expect(contrast(hex(fg), hex(bg))).toBeGreaterThanOrEqual(3)
  })

  it('known exception: the resting border of buttons and dropdowns is below 3:1', () => {
    // A deliberate trade-off, recorded in ADR-0010. It is limited to controls that always show text — a button's
    // label, a dropdown's current value and chevron — because WCAG 1.4.11 does not require a boundary when text
    // identifies the control. Inputs use border-field instead (checked above, and enforced below). Pinned so the docs
    // cannot drift into claiming the resting border passes.
    expect(contrast(hex('border-control'), hex('surface'))).toBeLessThan(3)
  })
})

describe('token definitions', () => {
  it('defines the same tokens in light and dark', () => {
    expect(Object.keys(tokens('.dark')).sort()).toEqual(Object.keys(tokens(':root')).sort())
  })

  it('every Tailwind colour points at a defined token', () => {
    const light = tokens(':root')
    const references = [...source.matchAll(/--color-[a-z-]+:\s*var\(--nb-([a-z-]+)\)/g)].map((m) => m[1] ?? '')
    expect(references.length).toBeGreaterThan(0)
    expect(references.filter((name) => !(name in light))).toEqual([])
  })
})

describe('generated CSS', () => {
  const tokenIn = (body: string, property: string) =>
    [...body.matchAll(new RegExp(`(?:^|;|\\s)${property}:\\s*var\\(--nb-([a-z-]+)\\)`, 'g'))].map((m) => m[1] ?? '')

  it('every text colour in use is checked in a text pair', () => {
    const used = new Set(utilityRules(css).flatMap((rule) => tokenIn(rule.body, 'color')))
    const checked = new Set(TEXT_PAIRS.map(([fg]) => fg))
    expect(used.size).toBeGreaterThan(0)
    expect([...used].filter((name) => !checked.has(name))).toEqual([])
  })

  it('every background colour in use is checked in a text pair, unless it carries no text', () => {
    const used = new Set(utilityRules(css).flatMap((rule) => tokenIn(rule.body, 'background-color')))
    const checked = new Set(TEXT_PAIRS.map(([, bg]) => bg))
    expect(used.size).toBeGreaterThan(0)
    expect([...used].filter((name) => !checked.has(name) && !DECORATIVE_BACKGROUNDS.has(name))).toEqual([])
  })

  it('only `surface-brand` paints the brand blue, so focus outlines stay visible on it', () => {
    // The default focus colour is 2.3:1 on the brand blue. Catches `bg-brand`, arbitrary values such as
    // `bg-(--nb-brand)` and the raw hex, in .ts and .tsx files alike.
    const brandHexes = [tokens(':root').brand, tokens('.dark').brand].filter(Boolean) as string[]
    const paintsBrand = (body: string) =>
      /background(-color)?:[^;]*(--nb-brand\)|--color-brand\))/.test(body) ||
      brandHexes.some((h) => new RegExp(`background(-color)?:[^;]*${h}`, 'i').test(body))
    const offenders = utilityRules(css).filter((rule) => paintsBrand(rule.body)).map((rule) => rule.selector)
    expect(offenders).toEqual(['.surface-brand'])
  })

  it('`surface-brand` swaps the focus colour', () => {
    const rule = utilityRules(css).find((r) => r.selector === '.surface-brand')
    expect(rule?.body).toMatch(/--nb-focus:\s*var\(--nb-focus-on-brand\)/)
  })

  it('the resting control border is used only by buttons and dropdowns, never by an input', () => {
    // The generated CSS cannot say which element a class lands on, so this one reads the source files.
    const users = sourceFiles(srcDir, /\.(ts|tsx)$/)
      .filter((file) => readFileSync(file, 'utf8').includes('border-control'))
      .map((file) => file.slice(srcDir.length + 1))
      .sort()
    expect(users).toEqual(['components/ui/Button.tsx', 'components/ui/Select.tsx'])
  })
})
