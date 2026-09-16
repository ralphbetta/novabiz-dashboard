import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  type Kobo,
  MAX_KOBO,
  MoneyError,
  toKobo,
  isKobo,
  formatNaira,
  formatAmount,
  formatSignedNaira,
  parseNairaInput,
  addKobo,
  subtractKobo,
  sumKobo,
} from './money'
import { createNairaFormatter, formatViaParts, toDecimalString } from './money.internal'

const k = (n: number) => n as Kobo
const anyKobo = fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER })

describe('toKobo', () => {
  it('accepts safe integers', () => {
    expect(toKobo(0)).toBe(0)
    expect(toKobo(100050)).toBe(100050)
    expect(toKobo(-250000)).toBe(-250000)
    expect(toKobo(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('rejects fractions, non-finite values, and integers past the safe range', () => {
    expect(() => toKobo(1000.5)).toThrow(MoneyError)
    expect(() => toKobo(NaN)).toThrow(MoneyError)
    expect(() => toKobo(Infinity)).toThrow(MoneyError)
    expect(() => toKobo(Number.MAX_SAFE_INTEGER + 1)).toThrow(MoneyError)
  })
})

describe('isKobo', () => {
  it('narrows correctly', () => {
    expect(isKobo(100)).toBe(true)
    expect(isKobo(1.5)).toBe(false)
    expect(isKobo('100')).toBe(false)
    expect(isKobo(null)).toBe(false)
  })
})

describe('formatNaira', () => {
  const cases: ReadonlyArray<readonly [number, string]> = [
    [0, '₦0.00'],
    [1, '₦0.01'],
    [99, '₦0.99'], // must NOT round up to ₦1.00
    [100, '₦1.00'],
    [100050, '₦1,000.50'],
    [99999, '₦999.99'],
    [-250000, '-₦2,500.00'],
    [-1, '-₦0.01'],
    [123456789, '₦1,234,567.89'],
    [Number.MAX_SAFE_INTEGER, '₦90,071,992,547,409.91'],
  ]

  it.each(cases)('formats %i kobo as %s', (kobo, expected) => {
    expect(formatNaira(k(kobo))).toBe(expected)
  })

  it('treats negative zero as zero', () => {
    expect(formatNaira(k(-0))).toBe('₦0.00')
  })

  it('uses U+002D hyphen-minus for negatives, matching every other negative in the app', () => {
    expect(formatNaira(k(-100)).codePointAt(0)).toBe(0x2d)
  })
})

describe('formatAmount', () => {
  it('omits the currency symbol for input fields', () => {
    expect(formatAmount(k(100050))).toBe('1,000.50')
    expect(formatAmount(k(0))).toBe('0.00')
  })
})

describe('formatSignedNaira', () => {
  it('signs by direction, so direction is never conveyed by colour alone', () => {
    expect(formatSignedNaira(k(100050), 'credit')).toBe('+₦1,000.50')
    expect(formatSignedNaira(k(100050), 'debit')).toBe('-₦1,000.50')
  })

  it('renders a debit identically to formatNaira of the negative amount', () => {
    // A balance and a transaction row must never show the same amount two different ways.
    expect(formatSignedNaira(k(250000), 'debit')).toBe(formatNaira(k(-250000)))
  })

  it.each(['credit', 'debit'] as const)(
    'throws on a negative amount with direction %s, rather than hiding a sign mismatch',
    (direction) => {
      expect(() => formatSignedNaira(k(-100050), direction)).toThrow(MoneyError)
    },
  )

  it('handles zero', () => {
    expect(formatSignedNaira(k(0), 'credit')).toBe('+₦0.00')
  })
})

describe('parseNairaInput', () => {
  const valid: ReadonlyArray<readonly [string, number]> = [
    ['1000.50', 100050],
    ['1,000.50', 100050],
    ['₦1,000.50', 100050],
    ['₦ 1,000.50', 100050],
    ['1,000,000.50', 100000050],
    ['1000', 100000],
    ['1000.5', 100050], // one decimal place means 50 kobo, not 5
    ['0.01', 1],
    ['  1000.50  ', 100050],
    ['-₦2,500.00', -250000],
    ['−₦2,500.00', -250000], // U+2212 MINUS SIGN, as pasted from typeset text
  ]

  it.each(valid)('parses %s', (input, expected) => {
    expect(parseNairaInput(input)).toBe(expected)
  })

  const invalid = [
    '', '   ', '-', '₦', 'abc', '1.234', '1e5', '1.2.3', '--5', '1,000.', '.50',
    '1,0,0,0',   // misplaced grouping
    '1,00.50',   // misplaced grouping
    '10 00',     // internal whitespace
    '1000,000',  // mixed grouped/ungrouped
    '₦-5',       // sign after symbol
  ]

  it.each(invalid)('rejects %j', (input) => {
    expect(parseNairaInput(input)).toBeNull()
  })

  it('never produces a float', () => {
    // The naive implementation, parseFloat('0.29') * 100, gives 28.999999999999996.
    expect(parseNairaInput('0.29')).toBe(29)
  })

  it('accepts zero and negatives — it is a parser, not a transfer validator (see ADR-0009)', () => {
    expect(parseNairaInput('0')).toBe(0)
    expect(parseNairaInput('-1.00')).toBe(-100)
  })
})

describe('arithmetic', () => {
  it('sums exactly where floats would drift', () => {
    // ₦0.10 + ₦0.20 in float arithmetic is 0.30000000000000004.
    expect(sumKobo([k(10), k(20)])).toBe(30)
    expect(addKobo(k(10), k(20))).toBe(30)
    expect(subtractKobo(k(100050), k(50))).toBe(100000)
    expect(sumKobo([])).toBe(0)
  })

  it('surfaces overflow rather than silently losing precision', () => {
    expect(() => addKobo(MAX_KOBO, k(1))).toThrow(MoneyError)
    expect(() => sumKobo([MAX_KOBO, k(1)])).toThrow(MoneyError)
  })
})

describe('locale fallback on reduced-ICU devices', () => {
  it('still renders ₦, not "NGN", when en-NG data is missing and it falls back to en', () => {
    // Without currencyDisplay: 'narrowSymbol', `en` renders "NGN 1,000.50".
    expect(createNairaFormatter('en', true).format(1000.5)).toBe('₦1,000.50')
    expect(createNairaFormatter('und', true).format(1000.5)).toBe('₦1,000.50')
  })
})

describe('property-based invariants', () => {
  it('round-trips: parseNairaInput(formatNaira(k)) === k  [10,000 runs]', () => {
    fc.assert(
      fc.property(anyKobo, (n) => {
        expect(parseNairaInput(formatNaira(k(n)))).toBe(n)
      }),
      { numRuns: 10_000 },
    )
  })

  it('always renders exactly two decimal places  [2,000 runs]', () => {
    fc.assert(
      fc.property(anyKobo, (n) => {
        expect(formatNaira(k(n))).toMatch(/^-?₦[\d,]+\.\d{2}$/)
      }),
      { numRuns: 2_000 },
    )
  })

  it('sums agree with exact BigInt arithmetic  [1,000 runs]', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -1e12, max: 1e12 }), { maxLength: 500 }), (xs) => {
        const viaBigInt = xs.reduce((a, b) => a + BigInt(b), 0n)
        expect(BigInt(sumKobo(xs.map(k)))).toBe(viaBigInt)
      }),
      { numRuns: 1_000 },
    )
  })

  it('the old-WebView fallback agrees with the primary path across the FULL range  [5,000 runs]', () => {
    // This is the property that caught the real bug. The round-trip above cannot: on any
    // engine with Intl V3 string input, which includes Node, it never reaches the fallback.
    const formatter = createNairaFormatter('en-NG', true)
    fc.assert(
      fc.property(anyKobo, (n) => {
        expect(formatViaParts(formatter, k(n))).toBe(formatNaira(k(n)))
      }),
      { numRuns: 5_000 },
    )
  })

  it('pins the amount that exposed the naive numeric fallback', () => {
    // format(Number(decimalString)) — and equally format(kobo / 100), which yields the same
    // double — is only exact below ~₦10 trillion. 16 significant digits do not survive a double.
    const formatter = createNairaFormatter('en-NG', true)
    const kobo = k(8_373_871_690_112_718)
    expect(formatter.format(Number(toDecimalString(kobo)))).toBe('₦83,738,716,901,127.19') // wrong
    expect(formatViaParts(formatter, kobo)).toBe('₦83,738,716,901,127.18')
    expect(formatNaira(kobo)).toBe('₦83,738,716,901,127.18')
  })
})
