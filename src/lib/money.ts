/**
 * Money — the single source of truth for currency in this app. See ADR-0002.
 *
 *   1. Money is always an integer number of kobo. Never a float, never a string.
 *   2. Arithmetic happens on integers, in this module.
 *   3. A decimal exists only at the moment of formatting for display.
 *   4. `/ 100`, `* 100` and `.toFixed()` are banned outside src/lib/money*.ts by an ESLint
 *      rule (eslint.config.js). The branded type alone does NOT prevent `{amount / 100}` in a
 *      component — Kobo is still a number, and arithmetic on it compiles. The lint rule is
 *      what does.
 */
import {
  createNairaFormatter,
  detectStringInputSupport,
  formatViaParts,
  toDecimalString,
} from './money.internal'

declare const koboBrand: unique symbol

/**
 * An integer number of kobo. 100 kobo = ₦1.
 *
 * The brand stops an arbitrary number being passed where money is expected — e.g.
 * `formatNaira(Date.now())`. It does not stop arithmetic on a Kobo; see rule 4 above.
 */
export type Kobo = number & { readonly [koboBrand]: true }

/** Largest representable amount: ₦90,071,992,547,409.91. */
export const MAX_KOBO = Number.MAX_SAFE_INTEGER as Kobo
export const ZERO_KOBO = 0 as Kobo

export class MoneyError extends RangeError {
  constructor(message: string) {
    super(message)
    this.name = 'MoneyError'
  }
}

export function isKobo(n: unknown): n is Kobo {
  return typeof n === 'number' && Number.isSafeInteger(n)
}

/** The only way to construct a Kobo. Call it at every API boundary; never cast. */
export function toKobo(n: number): Kobo {
  if (!Number.isFinite(n)) throw new MoneyError(`Not a finite amount: ${n}`)
  if (!Number.isInteger(n)) throw new MoneyError(`Kobo must be a whole number, got: ${n}`)
  if (!Number.isSafeInteger(n)) throw new MoneyError(`Amount exceeds safe range: ${n}`)
  return n as Kobo
}

// ---------------------------------------------------------------------------
// Formatting
//
// Negative amounts use U+002D HYPHEN-MINUS everywhere, because that is what Intl emits.
// Rows and balances therefore render the same amount identically, and every formatted
// string round-trips through parseNairaInput. See ADR-0002.
// ---------------------------------------------------------------------------

const nairaFormatter = createNairaFormatter('en-NG', true)
const plainFormatter = createNairaFormatter('en-NG', false)
const supportsStringInput = detectStringInputSupport()

function format(formatter: Intl.NumberFormat, kobo: Kobo): string {
  return supportsStringInput
    ? (formatter.format as (v: string) => string)(toDecimalString(kobo))
    : formatViaParts(formatter, kobo)
}

/** `100050` → `"₦1,000.50"`, `-250000` → `"-₦2,500.00"`. The only way to render an amount. */
export function formatNaira(kobo: Kobo): string {
  return format(nairaFormatter, kobo)
}

/** `100050` → `"1,000.50"`. Without the symbol, for input fields. */
export function formatAmount(kobo: Kobo): string {
  return format(plainFormatter, kobo)
}

/**
 * Transaction-row form: `"+₦1,000.50"` for a credit, `"-₦1,000.50"` for a debit.
 *
 * Takes a non-negative MAGNITUDE; `direction` alone decides the sign. A negative amount
 * throws rather than being silently absolute-valued, because two disagreeing sources of
 * sign is exactly the bug to surface loudly in a reconciliation flow.
 */
export function formatSignedNaira(magnitude: Kobo, direction: 'credit' | 'debit'): string {
  if (magnitude < 0) {
    throw new MoneyError(`formatSignedNaira expects a non-negative magnitude, got ${magnitude}`)
  }
  return direction === 'credit'
    ? `+${formatNaira(magnitude)}`
    : formatNaira(-magnitude as Kobo)
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Optional sign, optional ₦ (with optional space after it), then either correctly grouped
 * digits ("1,000,000") or ungrouped digits ("1000000"), then up to two decimal places.
 * Rejects misplaced separators: "1,0,0,0", "1,00.50", "10 00".
 */
const AMOUNT_PATTERN = /^(-)?₦?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/

/**
 * Parse an amount string into kobo: `"₦1,000.50"` → `100050`. Returns null if invalid.
 *
 * This is a PARSER, not a transfer validator. It accepts zero and negatives because they are
 * valid amounts in general. The Send Money schema (ADR-0009) must separately enforce a
 * positive amount, the minimum, and the available balance.
 *
 * Accepts U+2212 MINUS SIGN as well as hyphen-minus, since pasted text may contain either.
 */
export function parseNairaInput(input: string): Kobo | null {
  const match = AMOUNT_PATTERN.exec(input.trim().replace(/−/g, '-'))
  if (!match) return null

  const [, sign, whole = '', fraction = ''] = match
  const wholeKobo = Number(whole.replace(/,/g, '')) * 100
  const total = wholeKobo + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(wholeKobo) || !Number.isSafeInteger(total)) return null

  return (sign ? -total : total) as Kobo
}

// ---------------------------------------------------------------------------
// Arithmetic — overflow is surfaced, never silently absorbed
// ---------------------------------------------------------------------------

export function addKobo(a: Kobo, b: Kobo): Kobo {
  const result = a + b
  if (!Number.isSafeInteger(result)) throw new MoneyError(`Overflow adding ${a} + ${b}`)
  return result as Kobo
}

export function subtractKobo(a: Kobo, b: Kobo): Kobo {
  const result = a - b
  if (!Number.isSafeInteger(result)) throw new MoneyError(`Overflow subtracting ${b} from ${a}`)
  return result as Kobo
}

export function sumKobo(values: readonly Kobo[]): Kobo {
  let total = 0
  for (const value of values) {
    total += value
    if (!Number.isSafeInteger(total)) throw new MoneyError('Overflow summing kobo values')
  }
  return total as Kobo
}
