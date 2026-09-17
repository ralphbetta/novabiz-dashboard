/**
 * The amount field's editing rules (ADR-0009): the amount is grouped while the merchant types, only what an amount can
 * contain gets in, and the caret stays after the same character.
 *
 * The rule that matters most: **an edit that could mean a different amount is refused, never reinterpreted.** A phone
 * set to a European region shows "," as its decimal key, so "5000,50" means five thousand naira and fifty kobo; quietly
 * dropping the comma would make it ₦500,050 — a hundred times too much. So a typed comma, a pasted amount with commas in
 * the wrong places, and a second decimal point are all refused, the field keeps what it had, and the merchant is told
 * why. For the same reason a leading minus is kept: stripping it would turn a pasted "-1,000" into a ₦1,000 transfer.
 *
 * Pure string work — no number is ever made from the text here, so no float is involved (ADR-0002). What it produces is
 * still parsed by `parseNairaInput` and checked by the amount schema, which rejects zero, negatives and too much.
 */

/** More whole digits than this cannot be a real transfer, and would soon pass the safe-integer range in kobo. */
const MAX_WHOLE_DIGITS = 13
const MAX_FRACTION_DIGITS = 2

/** Why an edit was refused, in words for the merchant. */
export const AMOUNT_INPUT_PROBLEMS = {
  comma: 'Use a point for kobo, like 5,000.50',
  secondPoint: 'The amount already has a point',
  format: 'Enter an amount in naira, like 5,000 or 5,000.50',
  tooLarge: 'That amount is too large',
} as const

/** A pasted amount is accepted only when it is a complete, well-formed amount by itself. */
const PASTE_PATTERN = /^-?(\d{1,3}(,\d{3})+|\d+)?(\.\d{1,2})?$/

export interface AmountEdit {
  value: string
  caret: number
  /** Why the edit was refused, or null when it was applied or silently limited. */
  problem: string | null
}

/**
 * Applies one change to the field. `previous` is what the field showed; `raw` is what the browser now holds, with the
 * caret at `caret`. Returns the text to show, where to put the caret, and a problem when the edit was refused.
 */
export function applyAmountEdit(previous: string, raw: string, caret: number): AmountEdit {
  // Where the text changed: what was inserted, and what was removed.
  let start = 0
  while (start < previous.length && start < raw.length && previous[start] === raw[start]) start++
  let end = 0
  while (end < previous.length - start && end < raw.length - start && previous[previous.length - 1 - end] === raw[raw.length - 1 - end]) end++
  const inserted = raw.slice(start, raw.length - end)
  const removed = previous.slice(start, previous.length - end)
  const refuse = (problem: string | null): AmountEdit => ({ value: previous, caret: start, problem })

  if (inserted === '') {
    // Only a comma went: Backspace just after it. Keyboards that report every key as "Unidentified" (common on
    // Android) cannot be caught earlier, so it is handled here. The comma would come straight back; take the digit
    // before it instead.
    if (removed === ',' && start > 0) {
      return format(previous.slice(0, start - 1) + previous.slice(start + 1), start - 1)
    }
    return format(raw, caret)
  }

  const meaningful = inserted.replace(/[^0-9.,-]/g, '')
  if (meaningful === '') return format(raw, caret) // only letters, ₦ or spaces: dropped
  const pasted = meaningful.length > 1

  if (pasted) {
    const text = inserted.replace(/[₦\s]/g, '').replace(/[^0-9.,-]/g, '')
    if (!PASTE_PATTERN.test(text)) return refuse(AMOUNT_INPUT_PROBLEMS.format)
  } else if (meaningful === ',') {
    return refuse(AMOUNT_INPUT_PROBLEMS.comma)
  }

  const rest = raw.slice(0, start) + raw.slice(raw.length - end)
  if (meaningful.includes('.') && rest.includes('.')) return refuse(AMOUNT_INPUT_PROBLEMS.secondPoint)
  if (meaningful.includes('-') && (start > 0 || rest.includes('-'))) return pasted ? refuse(AMOUNT_INPUT_PROBLEMS.format) : refuse(null)

  // The result's own shape: too many decimals or whole digits is refused, not cut.
  const digits = raw.replace(/[^0-9.]/g, '')
  const [whole = '', fraction = ''] = digits.split('.')
  if (fraction.length > MAX_FRACTION_DIGITS) {
    return refuse(pasted || meaningful.includes('.') ? AMOUNT_INPUT_PROBLEMS.format : null)
  }
  if (whole.replace(/^0+/, '').length > MAX_WHOLE_DIGITS) return refuse(pasted ? AMOUNT_INPUT_PROBLEMS.tooLarge : null)

  return format(raw, caret)
}

/**
 * Groups an already-acceptable edit and places the caret. Commas are removed and put back in the right places; leading
 * zeros before the caret are dropped ("0005" → "5"), but not those after it, so deleting the "1" of "1,000,000" leaves
 * "000,000" ready for the next digit rather than collapsing it to "0".
 */
function format(raw: string, caret: number): AmountEdit {
  let sign = ''
  let whole = ''
  let hasPoint = false
  let fraction = ''
  let signBefore = 0
  let wholeBefore = 0
  let pointBefore = 0
  let fractionBefore = 0

  for (let i = 0; i < raw.length; i++) {
    const char = raw.charAt(i)
    const beforeCaret = i < caret
    if (char === '-' && !sign && !whole && !hasPoint) {
      sign = '-'
      if (beforeCaret) signBefore = 1
    } else if (char === '.' && !hasPoint) {
      hasPoint = true
      if (beforeCaret) pointBefore = 1
    } else if (char >= '0' && char <= '9') {
      if (!hasPoint) {
        whole += char
        if (beforeCaret) wholeBefore++
      } else {
        fraction += char
        if (beforeCaret) fractionBefore++
      }
    }
  }

  const leadingZeros = whole.length - whole.replace(/^0+(?=\d)/, '').length
  const dropped = Math.min(leadingZeros, wholeBefore)
  if (dropped > 0) {
    whole = whole.slice(dropped)
    wholeBefore -= dropped
  }
  if (hasPoint && whole === '') {
    whole = '0'
    if (pointBefore) wholeBefore = 1
  }

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const value = sign + grouped + (hasPoint ? `.${fraction}` : '')

  // Commas inside the first `wholeBefore` digits: one after digit j (1-based) when (length - j) is a multiple of three.
  // Digit `wholeBefore` itself is excluded, so a caret right before a comma stays before it.
  let commasBefore = 0
  for (let j = 1; j < wholeBefore; j++) if ((whole.length - j) % 3 === 0) commasBefore++

  const nextCaret = pointBefore || fractionBefore
    ? sign.length + grouped.length + 1 + fractionBefore
    : signBefore + wholeBefore + commasBefore
  return { value, caret: Math.min(nextCaret, value.length), problem: null }
}
