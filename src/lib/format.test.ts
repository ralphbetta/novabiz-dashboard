import { describe, it, expect } from 'vitest'
import { businessDateDaysAgo, formatCount, formatLongDate, formatTime, formatTransactionTime, greeting } from './format'

const NOW = new Date('2026-09-16T10:30:00.000Z') // 11:30 WAT on 16 Sep

describe('formatTransactionTime — business time (WAT), not the device timezone', () => {
  it.each([
    ['earlier today', '2026-09-16T08:02:00.000Z', 'Today, 09:02'],
    ['just after midnight WAT, while UTC is still yesterday', '2026-09-15T23:05:00.000Z', 'Today, 00:05'],
    ['yesterday', '2026-09-15T17:04:00.000Z', 'Yesterday, 18:04'],
    ['just before midnight WAT yesterday', '2026-09-15T22:55:00.000Z', 'Yesterday, 23:55'],
    ['two days ago, just before midnight WAT', '2026-09-14T22:55:00.000Z', '14 Sept, 23:55'],
    ['earlier this year', '2026-09-14T08:10:00.000Z', '14 Sept, 09:10'],
    ['a previous year', '2025-12-31T08:10:00.000Z', '31 Dec 2025, 09:10'],
  ])('%s', (_label, iso, expected) => {
    expect(formatTransactionTime(new Date(iso), NOW)).toBe(expected)
  })
})

describe('formatTime', () => {
  it('uses a 24-hour clock in business time', () => {
    expect(formatTime(new Date('2026-09-16T22:45:00.000Z'))).toBe('23:45')
  })
})

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(1200)).toBe('1,200')
  })
})

describe('businessDateDaysAgo', () => {
  it('counts back in business days', () => {
    expect(businessDateDaysAgo(0, NOW)).toBe('2026-09-16')
    expect(businessDateDaysAgo(6, NOW)).toBe('2026-09-10')
  })
})

describe('formatLongDate', () => {
  it('names the business day, which may differ from the UTC date', () => {
    expect(formatLongDate(new Date('2026-09-15T23:30:00.000Z'))).toBe('Wednesday, 16 September')
  })
})

describe('greeting — by business hour (WAT)', () => {
  it.each([
    ['11:59 WAT', '2026-09-16T10:59:00.000Z', 'Good morning'],
    ['12:00 WAT', '2026-09-16T11:00:00.000Z', 'Good afternoon'],
    ['16:59 WAT', '2026-09-16T15:59:00.000Z', 'Good afternoon'],
    ['17:00 WAT', '2026-09-16T16:00:00.000Z', 'Good evening'],
    ['00:30 WAT, while UTC is still the previous evening', '2026-09-15T23:30:00.000Z', 'Good morning'],
  ])('%s', (_label, iso, expected) => {
    expect(greeting(new Date(iso))).toBe(expected)
  })
})
