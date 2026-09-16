/**
 * Normalises untrusted text at the API boundary (ADR-0013), before anything renders it.
 *
 * React already escapes text, so `<script>` renders as harmless characters. What React does not do is remove
 * characters that change how text DISPLAYS. A right-to-left override can make "NGN 1,000 to Adebayo" appear to
 * name a different amount or recipient; a zero-width space can make two different names look identical. In a
 * payments UI those are spoofing vectors. Counterparty names arrive from other banks' customers via NIP, so
 * they are as untrusted as anything a merchant types.
 *
 * Deliberately NOT removed: letters, combining accents (Yoruba and Igbo diacritics are preserved, and composed
 * by NFC), emoji, and markup characters. One known cost: removing zero-width joiners splits joined emoji such as
 * family sequences into their parts. Legibility of money-adjacent text is worth more than that.
 */

export const UNTRUSTED_TEXT_MAX_LENGTH = 140
const ELLIPSIS = '…'

/** Control characters, and line and paragraph separators: shown as a single space. */
const CONTROLS_AND_SEPARATORS = /[\p{Cc}\p{Zl}\p{Zp}]/gu
/** Format characters: bidi overrides and isolates, zero-width spaces and joiners, byte-order marks. Removed. */
const FORMAT_CHARACTERS = /\p{Cf}/gu
/** Any space separator (non-breaking, em, ideographic…), and runs of ordinary whitespace: one space. */
const SPACES = /[\p{Zs}\s]+/gu

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

/** User-perceived characters. Falls back to code points on engines without Intl.Segmenter. */
function graphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text)
}

export function sanitizeText(input: string, maxLength = UNTRUSTED_TEXT_MAX_LENGTH): string {
  const cleaned = input
    .normalize('NFC')
    .replace(CONTROLS_AND_SEPARATORS, ' ')
    .replace(FORMAT_CHARACTERS, '')
    .replace(SPACES, ' ')
    .trim()

  const characters = graphemes(cleaned)
  if (characters.length <= maxLength) return cleaned
  return characters.slice(0, maxLength - 1).join('').trimEnd() + ELLIPSIS
}
