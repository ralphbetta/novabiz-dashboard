/**
 * Formatting mechanics behind money.ts, split out so they can be tested directly without
 * money.ts exporting test-only symbols. Nothing outside src/lib should import this file.
 */
import type { Kobo } from './money'

/**
 * `currencyDisplay: 'narrowSymbol'` matters on the devices we target. If a WebView ships
 * reduced ICU data without the en-NG locale, `en-NG` falls back to `en`, whose NGN symbol is
 * the ISO code: "NGN 1,000.50". The narrow symbol lives in root locale data, so it survives
 * that fallback and still renders "₦1,000.50". Verified on Node by formatting under `en`;
 * NOT yet verified on a real reduced-ICU Android WebView — see ADR-0002.
 */
export function createNairaFormatter(locale: string, withSymbol: boolean): Intl.NumberFormat {
  return new Intl.NumberFormat(locale, {
    ...(withSymbol ? { style: 'currency', currency: 'NGN', currencyDisplay: 'narrowSymbol' } : {}),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Intl.NumberFormat V3 lets `format()` take a decimal string. Older engines coerce the
 * argument with ToNumber. The probe must be a value that survives as a string but not as a
 * double; a probe like '1.5' passes on both paths and detects nothing.
 */
export function detectStringInputSupport(): boolean {
  try {
    const probe = new Intl.NumberFormat('en-US', { useGrouping: false })
    return (probe.format as (v: string) => string)('1234567890123456789') === '1234567890123456789'
  } catch {
    return false
  }
}

/** Exact decimal string for an integer kobo amount, built without a float: 100050 → "1000.50". */
export function toDecimalString(kobo: Kobo): string {
  const sign = kobo < 0 ? '-' : ''
  const abs = Math.abs(kobo)
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/**
 * Fallback for engines without string input.
 *
 * The obvious fallback, `format(Number(decimalString))`, is only exact below about
 * ₦10 trillion: above that the decimal needs 16 significant digits and a double holds 15.
 * A property test caught it returning ₦83,738,716,901,127.19 for …127.18.
 *
 * Instead, format the whole-naira part — a safe integer, so exact — and splice the two kobo
 * digits into the fraction slot. The sign is applied by hand because `whole` is 0 for
 * amounts under ₦1, and -0 would lose it.
 */
export function formatViaParts(formatter: Intl.NumberFormat, kobo: Kobo): string {
  const abs = Math.abs(kobo)
  const kobos = String(abs % 100).padStart(2, '0')
  const body = formatter
    .formatToParts(Math.trunc(abs / 100))
    .map((part) => (part.type === 'fraction' ? kobos : part.value))
    .join('')
  return kobo < 0 ? `-${body}` : body
}
