import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * No invisible or deceptive characters in source, docs or config.
 *
 * - Format characters (Unicode category Cf): bidirectional overrides and isolates, zero-width
 *   spaces and joiners, the byte-order mark. A raw right-to-left override is the Trojan Source
 *   pattern: code that displays differently from how it executes. A raw one has already slipped into
 *   this repo twice.
 * - Non-ASCII space separators, and line or paragraph separators: they look like ordinary whitespace.
 * - MINUS SIGN (U+2212): indistinguishable from a hyphen on screen, and this app parses amounts.
 *
 * Hostile fixtures that need these characters must write them as escape sequences.
 * ESLint's no-irregular-whitespace (configured strictly) catches some of these in the editor, but not
 * format characters that are not whitespace, and not in Markdown. This scan catches everything.
 */
const ROOTS = ['src', 'docs', 'eslint.config.js', 'vite.config.ts', 'vitest.config.ts', 'index.html', 'README.md', 'AGENT.md', 'AI_USAGE.md']
const TEXT_EXTENSIONS = /\.(ts|tsx|js|mjs|cjs|json|css|html|md)$/
const MINUS_SIGN = 0x2212
const FORMAT_OR_SEPARATOR = /[\p{Cf}\p{Zl}\p{Zp}]/u
const SPACE_SEPARATOR = /\p{Zs}/u

function* files(path: string): Generator<string> {
  const stat = statSync(path, { throwIfNoEntry: false })
  if (!stat) return
  if (stat.isFile()) {
    if (TEXT_EXTENSIONS.test(path)) yield path
    return
  }
  for (const entry of readdirSync(path)) yield* files(join(path, entry))
}

function isDeceptive(char: string): boolean {
  return (
    FORMAT_OR_SEPARATOR.test(char) ||
    (SPACE_SEPARATOR.test(char) && char !== ' ') ||
    char.codePointAt(0) === MINUS_SIGN
  )
}

describe('source hygiene', () => {
  it('contains no raw invisible, bidirectional or look-alike characters', () => {
    const findings: string[] = []
    for (const root of ROOTS) {
      for (const file of files(root)) {
        readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
          for (const char of line) {
            if (isDeceptive(char)) {
              const hex = (char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')
              findings.push(`${relative('.', file)}:${index + 1} U+${hex}`)
            }
          }
        })
      }
    }
    expect(findings).toEqual([])
  })

  it('the detector recognises what it is meant to — so a pass above means something', () => {
    for (const cp of [0x202e, 0x2066, 0x200b, 0x200d, 0xfeff, 0x00a0, 0x2028, MINUS_SIGN]) {
      expect(isDeceptive(String.fromCodePoint(cp)), `U+${cp.toString(16)}`).toBe(true)
    }
    for (const ok of [' ', '-', 'a', String.fromCodePoint(0x20a6), String.fromCodePoint(0x0300), String.fromCodePoint(0x2014)]) {
      expect(isDeceptive(ok), JSON.stringify(ok)).toBe(false)
    }
  })
})
