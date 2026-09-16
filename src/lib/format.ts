/**
 * Display formatting for dates, times and counts. Money formatting lives in money.ts.
 *
 * All times are shown in business time (WAT, see time.ts), not the device's local timezone: a merchant's
 * "today" and their transaction times must agree with the daily totals, whatever the phone is set to.
 * Implemented by shifting to the business offset and formatting in UTC, so it needs no timezone database.
 */
import { DAY_MS, UTC_OFFSET_MS, calendarDate } from './time'

const timeFormatter = new Intl.DateTimeFormat('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })
const dayMonthFormatter = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const dayMonthYearFormatter = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const countFormatter = new Intl.NumberFormat('en-NG')
const longDateFormatter = new Intl.DateTimeFormat('en-NG', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

const shifted = (at: Date) => new Date(at.getTime() + UTC_OFFSET_MS)

/** "11:32" in business time. */
export function formatTime(at: Date): string {
  return timeFormatter.format(shifted(at))
}

/**
 * A transaction's date and time, relative where that reads better: "Today, 11:32", "Yesterday, 18:04",
 * "14 Sep, 09:10", or "14 Sep 2025, 09:10" in an earlier year.
 */
export function formatTransactionTime(at: Date, now: Date): string {
  const time = formatTime(at)
  const day = calendarDate(at)
  if (day === calendarDate(now)) return `Today, ${time}`
  if (day === calendarDate(new Date(now.getTime() - DAY_MS))) return `Yesterday, ${time}`
  const sameYear = day.slice(0, 4) === calendarDate(now).slice(0, 4)
  return `${(sameYear ? dayMonthFormatter : dayMonthYearFormatter).format(shifted(at))}, ${time}`
}

/** "1,200". */
export function formatCount(n: number): string {
  return countFormatter.format(n)
}

/** The business calendar date `days` before `now`, as `YYYY-MM-DD`, for date-range presets. */
export function businessDateDaysAgo(days: number, now: Date): string {
  return calendarDate(new Date(now.getTime() - days * DAY_MS))
}

/** "Wednesday, 16 September" in business time. */
export function formatLongDate(at: Date): string {
  return longDateFormatter.format(shifted(at))
}

/** A greeting for the business hour: morning before 12:00, afternoon before 17:00, evening after. */
export function greeting(at: Date): string {
  const hour = shifted(at).getUTCHours()
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}
