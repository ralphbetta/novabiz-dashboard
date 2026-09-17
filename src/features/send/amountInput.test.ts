import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { parseNairaInput } from '../../lib/money'
import { AMOUNT_INPUT_PROBLEMS, applyAmountEdit } from './amountInput'

/** A field value with the caret at `|`. */
const split = (marked: string) => ({ value: marked.replace('|', ''), caret: marked.indexOf('|') })
const show = (result: { value: string; caret: number }) => `${result.value.slice(0, result.caret)}|${result.value.slice(result.caret)}`

/** What the browser hands onChange when `text` is typed or pasted at the caret (replacing nothing). */
function insert(marked: string, text: string) {
  const { value, caret } = split(marked)
  return applyAmountEdit(value, value.slice(0, caret) + text + value.slice(caret), caret + text.length)
}
/** Types `text` one character at a time, as a keyboard does. */
function typeEach(marked: string, text: string) {
  let current = marked
  let problem: string | null = null
  for (const char of text) {
    const result = insert(current, char)
    current = show(result)
    problem = result.problem
  }
  return { shown: current, problem }
}
/** Backspace at the caret, as onChange sees it whatever key the keyboard reported. */
function backspace(marked: string) {
  const { value, caret } = split(marked)
  return applyAmountEdit(value, value.slice(0, caret - 1) + value.slice(caret), caret - 1)
}

describe('applyAmountEdit — typing', () => {
  it.each([
    ['899889', '899,889|'],
    ['1234567', '1,234,567|'],
    ['1234.5', '1,234.5|'],
    ['1234.56', '1,234.56|'],
    ['1234.', '1,234.|'],
    ['.5', '0.5|'],
    ['0005', '5|'],
    ['0.0', '0.0|'],
    ['-5', '-5|'],
  ])('groups while typing %s', (text, expected) => {
    expect(typeEach('|', text)).toEqual({ shown: expected, problem: null })
  })

  it('drops letters silently', () => {
    expect(typeEach('|', 'pppp')).toEqual({ shown: '|', problem: null })
    expect(typeEach('|', '12a3')).toEqual({ shown: '1,23|'.replace('1,23', '123'), problem: null })
  })

  it.each([
    ['1|0,000', '5', '15|0,000'],
    ['1|,000', '2', '12|,000'],
    ['123,4|56.78', '9', '1,234,9|56.78'],
  ])('keeps the caret after the digit typed: %s + %s', (marked, text, expected) => {
    expect(show(insert(marked, text))).toBe(expected)
  })

  it('refuses a third decimal digit or a fourteenth whole digit without a message', () => {
    expect(insert('1,000.50|', '5')).toMatchObject({ value: '1,000.50', problem: null })
    expect(insert('1,234,567,890,123|', '4')).toMatchObject({ value: '1,234,567,890,123', problem: null })
  })
})

describe('applyAmountEdit — never reinterprets an amount (review finding 1)', () => {
  it.each(['5000,50', '5,5', '1.000,50', '1,000.505', '1.2.3', '5-0'])('refuses the paste %j and keeps the field as it was', (text) => {
    const result = insert('|', text)
    expect(result.value).toBe('')
    expect(result.problem).not.toBeNull()
  })

  it('refuses a typed comma, the decimal key on a phone set to a European region, with a hint', () => {
    expect(typeEach('|', '5000,')).toEqual({ shown: '5,000|', problem: AMOUNT_INPUT_PROBLEMS.comma })
  })

  it('accepts a well-formed pasted amount, with or without ₦, grouping or spaces', () => {
    expect(show(insert('|', '₦12,500.75'))).toBe('12,500.75|')
    expect(show(insert('|', '12500.75'))).toBe('12,500.75|')
    expect(show(insert('|', '5 000'))).toBe('5,000|')
  })
})

describe('applyAmountEdit — a second point (review finding 2)', () => {
  it('refuses a point typed into an amount that already has one, keeping its decimals', () => {
    expect(insert('1|,000.50', '.')).toMatchObject({ value: '1,000.50', caret: 1, problem: AMOUNT_INPUT_PROBLEMS.secondPoint })
  })

  it('refuses a point that would leave more than two decimals', () => {
    expect(insert('5|,000', '.')).toMatchObject({ value: '5,000', caret: 1 })
    expect(insert('5|,000', '.').problem).not.toBeNull()
  })
})

describe('applyAmountEdit — deleting (review finding 3 and Android Backspace)', () => {
  it('keeps the zeros after the caret when the first digit is deleted, so typing a new one restores the amount', () => {
    const deleted = backspace('1|,000,000')
    expect(show(deleted)).toBe('|000,000')
    expect(show(insert(show(deleted), '2'))).toBe('2|,000,000')
  })

  it('removes the digit before a comma when only the comma was deleted, whatever key was reported', () => {
    expect(show(backspace('899,|889'))).toBe('89|,889')
    expect(show(backspace('1,000,|000'))).toBe('100|,000')
  })

  it('regroups after an ordinary deletion', () => {
    expect(show(backspace('1,0|00'))).toBe('1|00') // the 0 before the caret goes: 100
  })
})

describe('applyAmountEdit — what it shows', () => {
  it('always parses to the same kobo as the digits typed', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[1-9][0-9]{0,11}(\.[0-9]{1,2})?$/), (typed) => {
        const { shown, problem } = typeEach('|', typed)
        expect(problem).toBeNull()
        expect(parseNairaInput(shown.replace('|', ''))).toBe(parseNairaInput(typed))
      }),
      { numRuns: 1_000 },
    )
  })
})
