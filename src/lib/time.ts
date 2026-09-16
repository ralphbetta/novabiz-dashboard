/**
 * Calendar-day helpers for the merchant's business day.
 *
 * All days in this app are West Africa Time (WAT): UTC+1 all year, no daylight saving. They are
 * NOT the device's local day. A merchant checking the dashboard at 00:30 expects "today" to have
 * just begun, whatever their phone's timezone setting says. Recorded as an assumption in README.
 *
 * A fixed offset is used rather than an IANA zone lookup because it is cheaper and exact for a
 * zone with no DST. time.test.ts checks it against Intl's zone data, so if that ever changes a
 * test fails rather than daily totals silently shifting by an hour.
 */

export const UTC_OFFSET_MS = 60 * 60 * 1000
export const DAY_MS = 24 * 60 * 60 * 1000

/** The instant the business day containing `at` began. */
export function startOfDay(at: Date): Date {
  const shifted = at.getTime() + UTC_OFFSET_MS
  const dayStartShifted = shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS)
  return new Date(dayStartShifted - UTC_OFFSET_MS)
}

/** The business calendar date of `at`, as `YYYY-MM-DD`. */
export function calendarDate(at: Date): string {
  return new Date(at.getTime() + UTC_OFFSET_MS).toISOString().slice(0, 10)
}

/** The UTC instants bounding a business calendar date: [start, endExclusive). */
export function dayBounds(date: string): { start: Date; endExclusive: Date } {
  const start = new Date(Date.parse(`${date}T00:00:00.000Z`) - UTC_OFFSET_MS)
  return { start, endExclusive: new Date(start.getTime() + DAY_MS) }
}
