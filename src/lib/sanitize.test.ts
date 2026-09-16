import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { UNTRUSTED_TEXT_MAX_LENGTH, sanitizeText } from './sanitize'
import { DIACRITIC_NAME, HOSTILE_DESCRIPTIONS } from '../mocks/seed'

const cp = (...codePoints: number[]) => String.fromCodePoint(...codePoints)
const RLO = cp(0x202e), PDF = cp(0x202c), ZWSP = cp(0x200b), ZWJ = cp(0x200d), BOM = cp(0xfeff), NBSP = cp(0xa0), LRI = cp(0x2066)

/** Anything that must never survive sanitising. */
const FORBIDDEN = /[\p{Cf}\p{Cc}\p{Zl}\p{Zp}]|(?! )\p{Zs}/u
const graphemeCount = (s: string) => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)).length

describe('sanitizeText', () => {
  it('leaves ordinary text alone', () => {
    expect(sanitizeText('QR payment from Chinedu Okafor')).toBe('QR payment from Chinedu Okafor')
  })

  it('keeps markup as literal text — escaping it is React\'s job, and removing it would hide the attack', () => {
    expect(sanitizeText(HOSTILE_DESCRIPTIONS.scriptTag)).toBe('<script>alert("xss")</script>')
  })

  it('removes a right-to-left override, so the amount cannot display reversed', () => {
    const out = sanitizeText(HOSTILE_DESCRIPTIONS.bidiOverride)
    expect(out).not.toMatch(FORBIDDEN)
    expect(out).toBe('Transfer to Musa 00.000,05' + cp(0x20a6))
  })

  it('removes bidi isolates as well as overrides', () => {
    expect(sanitizeText(`Pay ${LRI}Ada${cp(0x2069)}`)).toBe('Pay Ada')
  })

  it('removes zero-width characters and byte-order marks, so look-alike names are exposed', () => {
    expect(sanitizeText(`Ade${ZWSP}bayo${ZWJ} Stores${BOM}`)).toBe('Adebayo Stores')
    expect(sanitizeText(HOSTILE_DESCRIPTIONS.zeroWidth)).toBe('Adebayo Stores')
  })

  it('turns newlines, tabs and non-breaking spaces into single spaces', () => {
    expect(sanitizeText(`Line one\n\n\tLine${NBSP}${NBSP}two  `)).toBe('Line one Line two')
  })

  it('preserves Yoruba diacritics, composing a decomposed form with NFC', () => {
    expect(sanitizeText(DIACRITIC_NAME)).toBe(DIACRITIC_NAME.normalize('NFC'))
    const decomposed = 'O' + cp(0x0323) + cp(0x0300) // O + combining dot below + combining grave
    expect(sanitizeText(decomposed)).toBe(decomposed.normalize('NFC'))
    expect(sanitizeText(decomposed).length).toBeLessThan(decomposed.length)
  })

  it('keeps emoji', () => {
    expect(sanitizeText(HOSTILE_DESCRIPTIONS.emojiOnly)).toBe(HOSTILE_DESCRIPTIONS.emojiOnly)
  })

  it.each(['', '   ', `${ZWSP}${BOM}`, `${RLO}${PDF}`])('reduces text with nothing visible to an empty string: %j', (input) => {
    expect(sanitizeText(input)).toBe('')
  })

  it('truncates long text with an ellipsis, within the limit', () => {
    const out = sanitizeText(HOSTILE_DESCRIPTIONS.oversized)
    expect(graphemeCount(out)).toBe(UNTRUSTED_TEXT_MAX_LENGTH)
    expect(out.endsWith('…')).toBe(true)
  })

  it('never splits an emoji or an accented letter when truncating', () => {
    const accented = 'Ọ̀'.normalize('NFC')
    for (const tail of [cp(0x1f600), cp(0x1f44d, 0x1f3fd), accented]) {
      const out = sanitizeText('x'.repeat(UNTRUSTED_TEXT_MAX_LENGTH - 2) + tail.repeat(3))
      expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
      expect(graphemeCount(out)).toBeLessThanOrEqual(UNTRUSTED_TEXT_MAX_LENGTH)
    }
  })

  it('never outputs a forbidden character, never exceeds the limit, and is idempotent  [2,000 runs]', () => {
    const hostile = fc.constantFrom(RLO, PDF, ZWSP, ZWJ, BOM, NBSP, LRI, '\n', '\t', cp(0x2028), cp(0x0000), cp(0x0085))
    const text = fc.array(fc.oneof(fc.string({ unit: 'grapheme' }), hostile), { maxLength: 60 }).map((parts) => parts.join(''))
    fc.assert(
      fc.property(text, (input) => {
        const once = sanitizeText(input)
        expect(once).not.toMatch(FORBIDDEN)
        expect(graphemeCount(once)).toBeLessThanOrEqual(UNTRUSTED_TEXT_MAX_LENGTH)
        expect(sanitizeText(once)).toBe(once)
      }),
      { numRuns: 2_000 },
    )
  })
})
