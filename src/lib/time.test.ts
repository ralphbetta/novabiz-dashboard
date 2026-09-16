import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { startOfDay, calendarDate, dayBounds, DAY_MS } from './time'

describe('business day boundaries (WAT, UTC+1)', () => {
  it('starts the day at 23:00 UTC the previous evening', () => {
    expect(startOfDay(new Date('2026-09-16T10:30:00.000Z')).toISOString()).toBe('2026-09-15T23:00:00.000Z')
  })

  it('treats 00:05 WAT as the new day, though UTC is still the previous date', () => {
    const at = new Date('2026-09-15T23:05:00.000Z')
    expect(calendarDate(at)).toBe('2026-09-16')
    expect(startOfDay(at).toISOString()).toBe('2026-09-15T23:00:00.000Z')
  })

  it('treats 23:55 WAT as the same day', () => {
    expect(calendarDate(new Date('2026-09-16T22:55:00.000Z'))).toBe('2026-09-16')
  })

  it('returns exact [start, endExclusive) bounds for a date', () => {
    const { start, endExclusive } = dayBounds('2026-09-16')
    expect(start.toISOString()).toBe('2026-09-15T23:00:00.000Z')
    expect(endExclusive.getTime() - start.getTime()).toBe(DAY_MS)
  })

  it('handles instants before the Unix epoch', () => {
    expect(calendarDate(new Date('1969-12-31T23:30:00.000Z'))).toBe('1970-01-01')
  })

  it("agrees with Intl's Africa/Lagos zone data — guards the fixed-offset, no-DST assumption  [5,000 runs]", () => {
    const viaIntl = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit',
    })
    fc.assert(
      fc.property(fc.date({ min: new Date('2000-01-01'), max: new Date('2100-01-01'), noInvalidDate: true }), (d) => {
        expect(calendarDate(d)).toBe(viaIntl.format(d))
        expect(calendarDate(startOfDay(d))).toBe(calendarDate(d))
      }),
      { numRuns: 5_000 },
    )
  })
})
