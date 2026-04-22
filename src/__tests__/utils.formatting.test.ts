import { describe, it, expect } from 'vitest'
import {
  formatBytes,
  formatMetricNumber,
  formatImpactFactor,
  formatRecordKey,
  formatWeeklyCommentBullet,
  formatDate,
  formatTimestamp,
  formatShortDate,
  formatDateRange,
  isoWeeksInYear,
} from '../utils'

// ── formatBytes ───────────────────────────────────────────────────────────────
describe('formatBytes', () => {
  it('shows bytes for values < 1 KB', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('shows KB for 1 KB – 1 MB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024 - 1)).toBe('1024.0 KB')
  })

  it('shows MB for >= 1 MB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MB')
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB')
  })
})

// ── formatMetricNumber ────────────────────────────────────────────────────────
describe('formatMetricNumber', () => {
  it('returns integer as string', () => {
    expect(formatMetricNumber(0)).toBe('0')
    expect(formatMetricNumber(42)).toBe('42')
    expect(formatMetricNumber(1000)).toBe('1000')
  })

  it('returns one decimal for non-integers', () => {
    expect(formatMetricNumber(1.5)).toBe('1.5')
    expect(formatMetricNumber(3.14)).toBe('3.1')
    expect(formatMetricNumber(0.9)).toBe('0.9')
  })
})

// ── formatImpactFactor ────────────────────────────────────────────────────────
describe('formatImpactFactor', () => {
  it('returns "1" for non-finite values', () => {
    expect(formatImpactFactor(NaN)).toBe('1')
    expect(formatImpactFactor(Infinity)).toBe('1')
    expect(formatImpactFactor(-Infinity)).toBe('1')
  })

  it('formats integer values without decimals', () => {
    expect(formatImpactFactor(1)).toBe('1')
    expect(formatImpactFactor(2)).toBe('2')
    expect(formatImpactFactor(0)).toBe('0')
  })

  it('formats decimal values stripping trailing zeros', () => {
    expect(formatImpactFactor(1.5)).toBe('1.5')
    expect(formatImpactFactor(1.25)).toBe('1.25')
    expect(formatImpactFactor(1.10)).toBe('1.1')
    expect(formatImpactFactor(1.50)).toBe('1.5')
  })
})

// ── formatRecordKey ───────────────────────────────────────────────────────────
describe('formatRecordKey', () => {
  it('returns TRK- prefix with first 6 chars uppercased', () => {
    expect(formatRecordKey('abcdef123456')).toBe('TRK-ABCDEF')
    expect(formatRecordKey('abc')).toBe('TRK-ABC')
    expect(formatRecordKey('a1b2c3d4e5f6')).toBe('TRK-A1B2C3')
  })

  it('handles UUIDs', () => {
    expect(formatRecordKey('550e8400-e29b-41d4-a716-446655440000')).toBe('TRK-550E84')
  })
})

// ── formatWeeklyCommentBullet ─────────────────────────────────────────────────
describe('formatWeeklyCommentBullet', () => {
  it('returns single-line message unchanged (trimmed)', () => {
    expect(formatWeeklyCommentBullet('  hello world  ')).toBe('hello world')
  })

  it('indents continuation lines with 4 spaces', () => {
    const result = formatWeeklyCommentBullet('line one\nline two\nline three')
    expect(result).toBe('line one\n    line two\n    line three')
  })

  it('filters empty lines', () => {
    const result = formatWeeklyCommentBullet('line one\n\n\nline two')
    expect(result).toBe('line one\n    line two')
  })

  it('trims each line', () => {
    const result = formatWeeklyCommentBullet('  first  \n  second  ')
    expect(result).toBe('first\n    second')
  })
})

// ── formatDate ────────────────────────────────────────────────────────────────
describe('formatDate', () => {
  it('returns null for null input', () => {
    expect(formatDate(null)).toBeNull()
  })

  it('formats a Date as YYYY-MM-DD', () => {
    expect(formatDate(new Date('2024-03-15'))).toBe('2024-03-15')
  })
})

// ── formatTimestamp ───────────────────────────────────────────────────────────
describe('formatTimestamp', () => {
  it('returns "No data yet" for null', () => {
    expect(formatTimestamp(null)).toBe('No data yet')
  })

  it('formats an ISO timestamp to DD MMM YYYY, HH:mm', () => {
    const result = formatTimestamp('2024-06-01T14:30:00Z')
    expect(result).toMatch(/01 Jun 2024, \d{2}:\d{2}/)
  })
})

// ── formatShortDate ───────────────────────────────────────────────────────────
describe('formatShortDate', () => {
  it('returns "No data yet" for null', () => {
    expect(formatShortDate(null)).toBe('No data yet')
  })

  it('formats date as DD MMM YYYY', () => {
    expect(formatShortDate('2024-06-01')).toBe('01 Jun 2024')
  })
})

// ── formatDateRange ───────────────────────────────────────────────────────────
describe('formatDateRange', () => {
  it('formats start and end dates separated by dash', () => {
    expect(formatDateRange('2024-01-01', '2024-12-31')).toBe('01 Jan 2024 - 31 Dec 2024')
  })

  it('handles same start and end date', () => {
    expect(formatDateRange('2024-06-15', '2024-06-15')).toBe('15 Jun 2024 - 15 Jun 2024')
  })

  it('labels an empty end date as open', () => {
    expect(formatDateRange('2024-06-15', '')).toBe('15 Jun 2024 - Open')
  })
})

// ── isoWeeksInYear ────────────────────────────────────────────────────────────
describe('isoWeeksInYear', () => {
  it('returns 52 for most years', () => {
    expect(isoWeeksInYear(2023)).toBe(52)
    expect(isoWeeksInYear(2022)).toBe(52)
  })

  it('returns 53 for long years', () => {
    expect(isoWeeksInYear(2020)).toBe(53)
    expect(isoWeeksInYear(2015)).toBe(53)
  })
})
